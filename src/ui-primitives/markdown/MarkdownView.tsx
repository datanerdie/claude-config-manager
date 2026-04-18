import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkAlerts } from './alerts'
import { CodeBlock } from './CodeBlock'

interface Props {
  value: string
}

export function MarkdownView({ value }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkAlerts]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code({ className, children, ...rest }) {
          const match = /language-(\w+)/.exec(className ?? '')
          if (match) {
            return (
              <CodeBlock
                code={String(children).replace(/\n$/, '')}
                lang={match[1] ?? 'text'}
              />
            )
          }
          return (
            <code className={className} {...rest}>
              {children}
            </code>
          )
        },
      }}
    >
      {value}
    </ReactMarkdown>
  )
}
