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

#[tauri::command]
pub fn home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "home directory not found".into())
}

#[tauri::command]
pub async fn read_text(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path).await.map_err(to_err)
}

#[tauri::command]
pub async fn write_text(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(to_err)?;
    }
    tokio::fs::write(&path, contents).await.map_err(to_err)
}

#[tauri::command]
pub async fn read_json(path: String) -> Result<serde_json::Value, String> {
    let text = tokio::fs::read_to_string(&path).await.map_err(to_err)?;
    serde_json::from_str(&text).map_err(to_err)
}

#[tauri::command]
pub async fn write_json(path: String, value: serde_json::Value) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(to_err)?;
    }
    let text = serde_json::to_string_pretty(&value).map_err(to_err)?;
    tokio::fs::write(&path, text).await.map_err(to_err)
}

#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    Ok(tokio::fs::try_exists(&path).await.unwrap_or(false))
}

#[tauri::command]
pub async fn ensure_dir(path: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&path).await.map_err(to_err)
}

#[tauri::command]
pub async fn remove_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        tokio::fs::remove_dir_all(&p).await.map_err(to_err)
    } else {
        tokio::fs::remove_file(&p).await.map_err(to_err)
    }
}

#[tauri::command]
pub async fn rename_path(from: String, to: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&to).parent() {
        tokio::fs::create_dir_all(parent).await.map_err(to_err)?;
    }
    tokio::fs::rename(&from, &to).await.map_err(to_err)
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
        entries.push(DirEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            path: e.path().to_string_lossy().into_owned(),
            is_dir: ft.is_dir(),
            is_file: ft.is_file(),
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
            out.push(DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                path: p.to_string_lossy().into_owned(),
                is_dir: ft.is_dir(),
                is_file: ft.is_file(),
            });
            if ft.is_dir() {
                walk(&p, depth + 1, max, out).await;
            }
        }
    })
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
            !matches!(
                name,
                "node_modules"
                    | "target"
                    | "dist"
                    | "build"
                    | ".git"
                    | ".next"
                    | ".cache"
                    | ".deleted"
                    | "__pycache__"
            )
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
