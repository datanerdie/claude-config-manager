use ignore::{WalkBuilder, WalkState};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

#[derive(Serialize, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_file: bool,
    /// mtime in milliseconds since UNIX epoch; 0 if unavailable.
    pub mtime: u64,
    /// File size in bytes; 0 if unavailable or if this is a directory.
    pub size: u64,
}

async fn stamp_for(e: &tokio::fs::DirEntry, is_file: bool) -> (u64, u64) {
    let meta = match e.metadata().await {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let size = if is_file { meta.len() } else { 0 };
    (mtime, size)
}

#[derive(Serialize, Clone)]
pub struct FsChange {
    pub kind: String,
    pub paths: Vec<String>,
}

#[derive(Default)]
pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

fn to_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Paths the app must never touch even if a config file points there.
/// Denylist (rather than home-only allowlist) so we don't break valid
/// projects on external mounts like `/Volumes/data/foo` on macOS.
#[cfg(unix)]
const DENIED_PREFIXES: &[&str] = &[
    "/etc",
    "/root",
    "/proc",
    "/sys",
    "/dev",
    "/boot",
    "/usr/bin",
    "/usr/sbin",
    "/sbin",
    "/bin",
    "/System",
    "/Library/Keychains",
    "/private/etc",
    "/private/var/db",
];

#[cfg(windows)]
const DENIED_PREFIXES: &[&str] = &[
    r"C:\Windows",
    r"C:\Program Files",
    r"C:\Program Files (x86)",
    r"C:\ProgramData",
];

/// Sensitive subdirectories under the user's home — `.ssh`, cloud
/// credentials, GPG, etc. The app legitimately writes to `~/.claude` and
/// `~/.config/ccm`, so we explicitly enumerate the off-limits ones rather
/// than blocking all dotfiles.
const DENIED_HOME_SUBDIRS: &[&str] = &[
    ".ssh",
    ".aws",
    ".gnupg",
    ".kube",
    ".docker",
    ".gcloud",
    ".config/gcloud",
    ".password-store",
    "Library/Keychains",
];

/// Validate a path before passing it to filesystem operations.
///
/// Threat model: a malicious config file (e.g. an `installPath` injected
/// via a marketplace plugin manifest) tricking the app into reading,
/// writing, or deleting files outside the user's intended workspace.
///
/// Rules:
/// - Path must be absolute; relative paths resolve against the app CWD,
///   which is unpredictable.
/// - Path must not contain `..` components. Checked pre-canonicalize so
///   non-existent paths (writes, mkdir) are still rejected.
/// - Resolved path must not start with any denied system or sensitive
///   home subdirectory. The deepest existing ancestor is canonicalized
///   so symlink-based escapes are caught even when the leaf doesn't exist
///   yet.
fn safe_path(input: &str) -> Result<PathBuf, String> {
    let p = Path::new(input);
    if !p.is_absolute() {
        return Err(format!("path must be absolute: {input}"));
    }
    if p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(format!("path must not contain '..': {input}"));
    }

    let (existing, tail) = split_existing(p);
    let canonical_root = existing
        .canonicalize()
        .map_err(|_| format!("path is not accessible: {input}"))?;
    // PathBuf::join with an empty tail appends a trailing separator on
    // Unix, which turns a valid file path into a directory path and makes
    // every subsequent read fail with NotADirectory. Only join when the
    // tail actually contributes new components.
    let resolved = if tail.as_os_str().is_empty() {
        canonical_root
    } else {
        canonical_root.join(&tail)
    };

    for denied in DENIED_PREFIXES {
        if resolved.starts_with(denied) {
            return Err(format!("path is in a protected location: {input}"));
        }
    }
    if let Some(home) = dirs::home_dir() {
        for sub in DENIED_HOME_SUBDIRS {
            if resolved.starts_with(home.join(sub)) {
                return Err(format!("path is in a protected location: {input}"));
            }
        }
    }
    Ok(resolved)
}

/// Walk up `p` until we find a component that exists; return that prefix
/// plus the trailing components that don't exist yet. Lets safe_path
/// canonicalize symlinks in the existing portion even when the leaf is
/// being newly created.
fn split_existing(p: &Path) -> (PathBuf, PathBuf) {
    let mut prefix = p.to_path_buf();
    let mut tail = PathBuf::new();
    while !prefix.exists() {
        let Some(name) = prefix.file_name().map(|n| n.to_owned()) else {
            break;
        };
        let mut new_tail = PathBuf::from(name);
        new_tail.push(&tail);
        tail = new_tail;
        if !prefix.pop() {
            break;
        }
    }
    (prefix, tail)
}

#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "home directory not found".into())
}

#[tauri::command]
pub async fn read_text(path: String) -> Result<String, String> {
    let safe = safe_path(&path)?;
    tokio::fs::read_to_string(&safe).await.map_err(to_err)
}

#[tauri::command]
pub async fn write_text(path: String, contents: String) -> Result<(), String> {
    let safe = safe_path(&path)?;
    if let Some(parent) = safe.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(to_err)?;
    }
    tokio::fs::write(&safe, contents).await.map_err(to_err)
}

#[tauri::command]
pub async fn read_json(path: String) -> Result<serde_json::Value, String> {
    let safe = safe_path(&path)?;
    let text = tokio::fs::read_to_string(&safe).await.map_err(to_err)?;
    serde_json::from_str(&text).map_err(to_err)
}

#[tauri::command]
pub async fn write_json(path: String, value: serde_json::Value) -> Result<(), String> {
    let safe = safe_path(&path)?;
    if let Some(parent) = safe.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(to_err)?;
    }
    let text = serde_json::to_string_pretty(&value).map_err(to_err)?;
    tokio::fs::write(&safe, text).await.map_err(to_err)
}

#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    // Existence probes don't reveal contents; still validate to avoid
    // turning this into a primitive for mapping the filesystem.
    let safe = match safe_path(&path) {
        Ok(p) => p,
        Err(_) => return Ok(false),
    };
    Ok(tokio::fs::try_exists(&safe).await.unwrap_or(false))
}

#[tauri::command]
pub async fn ensure_dir(path: String) -> Result<(), String> {
    let safe = safe_path(&path)?;
    tokio::fs::create_dir_all(&safe).await.map_err(to_err)
}

#[tauri::command]
pub async fn remove_path(path: String) -> Result<(), String> {
    let safe = safe_path(&path)?;
    if !safe.exists() {
        return Ok(());
    }
    if safe.is_dir() {
        tokio::fs::remove_dir_all(&safe).await.map_err(to_err)
    } else {
        tokio::fs::remove_file(&safe).await.map_err(to_err)
    }
}

#[tauri::command]
pub async fn rename_path(from: String, to: String) -> Result<(), String> {
    let safe_from = safe_path(&from)?;
    let safe_to = safe_path(&to)?;
    if let Some(parent) = safe_to.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(to_err)?;
    }
    tokio::fs::rename(&safe_from, &safe_to).await.map_err(to_err)
}

#[tauri::command]
pub async fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut entries = Vec::new();
    let mut rd = match tokio::fs::read_dir(&path).await {
        Ok(rd) => rd,
        Err(_) => return Ok(entries),
    };
    while let Ok(Some(e)) = rd.next_entry().await {
        let ft = match e.file_type().await {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let (mtime, size) = stamp_for(&e, ft.is_file()).await;
        entries.push(DirEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            path: e.path().to_string_lossy().into_owned(),
            is_dir: ft.is_dir(),
            is_file: ft.is_file(),
            mtime,
            size,
        });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn list_dir_recursive(
    path: String,
    max_depth: Option<usize>,
) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    let root = PathBuf::from(&path);
    let max = max_depth.unwrap_or(8);
    walk(&root, 0, max, &mut out).await;
    Ok(out)
}

fn walk<'a>(
    dir: &'a Path,
    depth: usize,
    max: usize,
    out: &'a mut Vec<DirEntry>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        if depth > max {
            return;
        }
        let mut rd = match tokio::fs::read_dir(dir).await {
            Ok(rd) => rd,
            Err(_) => return,
        };
        while let Ok(Some(e)) = rd.next_entry().await {
            let ft = match e.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            let p = e.path();
            let (mtime, size) = stamp_for(&e, ft.is_file()).await;
            out.push(DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: p.to_string_lossy().into_owned(),
                is_dir: ft.is_dir(),
                is_file: ft.is_file(),
                mtime,
                size,
            });
            if ft.is_dir() {
                walk(&p, depth + 1, max, out).await;
            }
        }
    })
}

/// Directories we never descend into during tree walks. Consolidated here so
/// the two walkers (`scan_for_projects`, `find_files_named`) stay in lockstep.
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".next",
    ".cache",
    ".deleted",
    "__pycache__",
];

fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIRS.iter().any(|d| *d == name)
}

/// Parallel, gitignore-aware walk that collects every file whose name matches
/// `name`. Each hit carries its stamp (`mtime`, `size`) so adapters can
/// cache-hit without a follow-up stat.
///
/// Dramatically faster than the generic `list_dir_recursive` for targeted
/// lookups (e.g. finding every `CLAUDE.md` in a project) because it skips
/// `node_modules/`, `target/`, gitignored paths, etc. at the walker level
/// rather than filtering after the fact.
#[tauri::command]
pub async fn find_files_named(
    root: String,
    name: String,
    max_depth: Option<usize>,
) -> Result<Vec<DirEntry>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Ok(Vec::new());
    }
    let depth = max_depth.unwrap_or(8);
    let target = Arc::new(name);
    let hits: Arc<Mutex<Vec<DirEntry>>> = Arc::new(Mutex::new(Vec::new()));

    let walker = WalkBuilder::new(&root_path)
        .max_depth(Some(depth))
        .hidden(false)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .filter_entry(|e| {
            let n = e.file_name().to_str().unwrap_or("");
            !is_ignored_dir(n)
        })
        .build_parallel();

    walker.run(|| {
        let hits = Arc::clone(&hits);
        let target = Arc::clone(&target);
        Box::new(move |result| {
            let entry = match result {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };
            let path = entry.path();
            let fname = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => return WalkState::Continue,
            };
            if fname != target.as_str() {
                return WalkState::Continue;
            }
            let ft = match entry.file_type() {
                Some(ft) => ft,
                None => return WalkState::Continue,
            };
            if !ft.is_file() {
                return WalkState::Continue;
            }
            let meta = entry.metadata().ok();
            let mtime = meta
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let hit = DirEntry {
                name: fname.to_string(),
                path: path.to_string_lossy().into_owned(),
                is_dir: false,
                is_file: true,
                mtime,
                size,
            };
            if let Ok(mut m) = hits.lock() {
                m.push(hit);
            }
            WalkState::Continue
        })
    });

    let mut guard = hits.lock().map_err(|e| e.to_string())?;
    Ok(std::mem::take(&mut *guard))
}

#[derive(Serialize)]
pub struct ProjectHit {
    pub path: String,
    pub has_claude_md: bool,
    pub has_claude_dir: bool,
}

#[tauri::command]
pub async fn scan_for_projects(
    root: String,
    max_depth: Option<usize>,
) -> Result<Vec<ProjectHit>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        return Err(format!("path does not exist: {root}"));
    }
    let depth = max_depth.unwrap_or(8);
    let hits: Arc<Mutex<HashMap<PathBuf, (bool, bool)>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let walker = WalkBuilder::new(&root_path)
        .max_depth(Some(depth))
        .hidden(false)
        .follow_links(false)
        .git_ignore(true)
        .git_global(false)
        .git_exclude(false)
        .require_git(false)
        .filter_entry(|e| {
            let name = e.file_name().to_str().unwrap_or("");
            !is_ignored_dir(name)
        })
        .build_parallel();

    walker.run(|| {
        let hits = Arc::clone(&hits);
        Box::new(move |result| {
            let entry = match result {
                Ok(e) => e,
                Err(_) => return WalkState::Continue,
            };
            let path = entry.path();
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => return WalkState::Continue,
            };
            let ft = match entry.file_type() {
                Some(ft) => ft,
                None => return WalkState::Continue,
            };

            if name == ".claude" && ft.is_dir() {
                if let Some(parent) = path.parent() {
                    let mut m = hits.lock().unwrap();
                    let e = m.entry(parent.to_path_buf()).or_insert((false, false));
                    e.1 = true;
                }
                return WalkState::Skip;
            }
            if name == "CLAUDE.md" && ft.is_file() {
                if let Some(parent) = path.parent() {
                    let mut m = hits.lock().unwrap();
                    let e = m.entry(parent.to_path_buf()).or_insert((false, false));
                    e.0 = true;
                }
            }
            WalkState::Continue
        })
    });

    let guard = hits.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<ProjectHit> = guard
        .iter()
        .map(|(p, (md, dir))| ProjectHit {
            path: p.to_string_lossy().into_owned(),
            has_claude_md: *md,
            has_claude_dir: *dir,
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

#[tauri::command]
pub fn watch_paths(
    paths: Vec<String>,
    state: State<'_, WatcherState>,
    window: tauri::Window,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(to_err)?;
    *guard = None;
    let win = window.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                let kind = match ev.kind {
                    EventKind::Create(_) => "create",
                    EventKind::Modify(_) => "modify",
                    EventKind::Remove(_) => "remove",
                    _ => "other",
                };
                let change = FsChange {
                    kind: kind.into(),
                    paths: ev
                        .paths
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect(),
                };
                let _ = win.emit("fs:change", change);
            }
        },
        Config::default(),
    )
    .map_err(to_err)?;
    for p in &paths {
        let path = Path::new(p);
        if path.exists() {
            let _ = watcher.watch(path, RecursiveMode::Recursive);
        }
    }
    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unwatch_all(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(to_err)?;
    *guard = None;
    Ok(())
}

/// Validate that an `open_external` target is one of a small set of safe
/// schemes. Rejects:
/// - UNC paths (`\\host\share`) which can leak NTLM hashes on Windows
/// - cmd.exe metacharacters (`&`, `|`, `^`, `<`, `>`, `"`, `%`) which can
///   break out of `start` argument parsing on Windows
/// - Anything that isn't `http://`, `https://`, or `mailto:`
fn validate_external_target(target: &str) -> Result<(), String> {
    if target.starts_with(r"\\") || target.starts_with("//") {
        return Err("UNC paths are not allowed".into());
    }
    if target.contains(['\0', '\n', '\r']) {
        return Err("control characters not allowed in URL".into());
    }
    let lower = target.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:");
    if !scheme_ok {
        return Err("only http(s) and mailto URLs may be opened externally".into());
    }
    if cfg!(target_os = "windows") && target.contains(['&', '|', '^', '<', '>', '"', '%']) {
        return Err("URL contains characters disallowed on Windows".into());
    }
    Ok(())
}

/// Open a URL in the user's default browser.
///
/// Restricted to `http://`, `https://`, and `mailto:` schemes. File paths
/// and arbitrary protocols are rejected to prevent exfiltration via UNC
/// paths or command injection via cmd.exe metacharacter parsing on Windows.
///
/// On Windows, invokes `rundll32 url.dll,FileProtocolHandler <url>` instead
/// of `cmd /C start`, sidestepping cmd's argument re-parsing entirely.
#[tauri::command]
pub async fn open_external(target: String) -> Result<(), String> {
    validate_external_target(&target)?;

    #[cfg(target_os = "windows")]
    {
        let status = std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &target])
            .status()
            .map_err(to_err)?;
        if !status.success() {
            return Err(format!("rundll32 exited with {}", status));
        }
    }
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg(&target)
            .status()
            .map_err(to_err)?;
        if !status.success() {
            return Err(format!("open exited with {}", status));
        }
    }
    #[cfg(target_os = "linux")]
    {
        let status = std::process::Command::new("xdg-open")
            .arg(&target)
            .status()
            .map_err(to_err)?;
        if !status.success() {
            return Err(format!("xdg-open exited with {}", status));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{safe_path, validate_external_target};

    #[test]
    fn safe_path_allows_home_subpath() {
        let home = dirs::home_dir().unwrap();
        let p = home.join(".claude").join("settings.json");
        assert!(safe_path(p.to_str().unwrap()).is_ok());
    }

    #[test]
    fn safe_path_does_not_add_trailing_separator_for_existing_file() {
        // Regression: PathBuf::join with an empty tail used to append "/"
        // to existing files, turning every read into NotADirectory.
        let tmp = std::env::temp_dir();
        // tmp is reliably canonicalize-able and under the user; pick a real
        // existing file inside the user's home if available, else fall back.
        let home = dirs::home_dir().unwrap();
        let candidate = home.join(".bashrc");
        let probe = if candidate.exists() {
            candidate
        } else {
            // Create a temp file under home so we exercise the real path.
            let p = tmp.join(format!("ccm_probe_{}", std::process::id()));
            std::fs::write(&p, b"x").unwrap();
            p
        };
        let resolved = safe_path(probe.to_str().unwrap()).unwrap();
        let s = resolved.to_string_lossy();
        assert!(!s.ends_with('/'), "resolved path has trailing slash: {s}");
    }

    #[test]
    fn safe_path_rejects_relative() {
        assert!(safe_path("relative/path").is_err());
        assert!(safe_path(".claude/settings.json").is_err());
    }

    #[test]
    fn safe_path_rejects_parent_dir() {
        let home = dirs::home_dir().unwrap();
        let p = home.join("..").join("etc").join("passwd");
        assert!(safe_path(p.to_str().unwrap()).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn safe_path_rejects_system_dirs() {
        assert!(safe_path("/etc/passwd").is_err());
        assert!(safe_path("/usr/bin/sh").is_err());
        assert!(safe_path("/sbin/init").is_err());
    }

    #[test]
    #[cfg(unix)]
    fn safe_path_rejects_ssh_dir() {
        let home = dirs::home_dir().unwrap();
        let ssh = home.join(".ssh").join("id_rsa");
        assert!(safe_path(ssh.to_str().unwrap()).is_err());
    }

    #[test]
    fn allows_https() {
        assert!(validate_external_target("https://example.com").is_ok());
    }

    #[test]
    fn allows_http_and_mailto() {
        assert!(validate_external_target("http://example.com").is_ok());
        assert!(validate_external_target("mailto:user@example.com").is_ok());
    }

    #[test]
    fn rejects_unc_path() {
        assert!(validate_external_target(r"\\attacker.com\share").is_err());
        assert!(validate_external_target("//attacker.com/share").is_err());
    }

    #[test]
    fn rejects_file_scheme() {
        assert!(validate_external_target("file:///etc/passwd").is_err());
    }

    #[test]
    fn rejects_javascript_scheme() {
        assert!(validate_external_target("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_control_chars() {
        assert!(validate_external_target("https://example.com\nrm -rf /").is_err());
    }
}

#[derive(Serialize)]
pub struct CliResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Spawn the `claude` CLI with the given arguments.
///
/// On Windows the CLI is typically installed as a `.cmd` shim, so we invoke
/// it via `cmd /C` to let the shell resolve the binary. On other platforms
/// we exec the binary directly.
#[tauri::command]
pub async fn run_claude_cli(
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<CliResult, String> {
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(300_000));

    let mut command = if cfg!(target_os = "windows") {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg("claude");
        for a in &args {
            c.arg(a);
        }
        c
    } else {
        let mut c = tokio::process::Command::new("claude");
        for a in &args {
            c.arg(a);
        }
        c
    };

    let child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn claude CLI: {e}"))?;

    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| format!("claude CLI timed out after {}ms", timeout.as_millis()))?
        .map_err(|e| format!("failed to read claude CLI output: {e}"))?;

    Ok(CliResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code().unwrap_or(-1),
    })
}
