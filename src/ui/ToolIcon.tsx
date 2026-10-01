import type { EditorTool } from '../editor/AnnotationLayer'

interface Props {
  tool: EditorTool
  className?: string
}

const common = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function ToolIcon({ tool, className = '' }: Props) {
  const content = (() => {
    switch (tool) {
      case 'issue': return <><circle {...common} cx="8" cy="8" r="6" /><text x="8" y="11" textAnchor="middle" fontSize="9" fill="currentColor">1</text></>
      case 'cloudSquare':
      case 'cloudPolygon': return <path {...common} d="M3 4Q1 1 5 3Q8 0 10 3Q15 1 13 5Q17 8 13 10Q15 15 10 13Q7 17 5 13Q0 15 3 10Q0 7 3 4Z" />
      case 'distance': return <><path {...common} d="M2 11h12M4 9l-2 2 2 2M12 9l2 2-2 2" /><text x="4" y="7" fontSize="6" fill="currentColor">100</text></>
      case 'perimeter': return <path {...common} d="M2 13l4-8 5 5 3-7" />
      case 'area': return <><path {...common} d="M2 12 4 3l9 2 1 8zM3 9l5-5M5 12l7-7M9 13l4-4" /></>
      case 'select':
        return <><path {...common} d="M3 2.2v10.4l2.5-2.3 1.8 3.5 1.7-.9-1.8-3.4 3.4-.4z" /></>
      case 'text':
        return <><path {...common} d="M3 3h10M8 3v10M5.5 13h5" /></>
      case 'callout':
        return <><path {...common} d="M2.5 3.2h11v7.2H8l-3.4 2.7.7-2.7H2.5z" /><path {...common} d="M5 5.7h6M5 8h4" /></>
      case 'line':
        return <><path {...common} d="M2.5 12.5 13.5 3.5" /></>
      case 'arrow':
        return <><path {...common} d="M2.5 12.5 13 3.8M8.8 3.6l4.5-.1-.7 4.4" /></>
      case 'square':
        return <><rect {...common} x="2.7" y="2.7" width="10.6" height="10.6" rx=".6" /></>
      case 'circle':
        return <><circle {...common} cx="8" cy="8" r="5.3" /></>
      case 'symbol':
        return <><path {...common} d="m8 2 1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 10.8l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" /></>
      case 'highlight':
        return <><path d="M2 12c2-2 3.5 2 5.4 0s3.4 2 6.6-.2" fill="none" stroke="#ffd600" strokeWidth="3" strokeLinecap="round" /><path {...common} d="m4 2.5 4.2 4.2-2.7 2.7-3-1 1-3zM4 2.5l1-1 4.2 4.2-1 1" /></>
      case 'ink':
        return <><path {...common} d="M2 12.8c2.3-3.5 4 1.1 6-1.5 1.6-2 3.2.8 5.8-1.8" /><path {...common} d="m4 2.5 4.2 4.2-2.7 2.7-3-1 1-3zM4 2.5l1-1 4.2 4.2-1 1" /></>
      case 'textSelect':
        return <><rect x="1.5" y="5.2" width="9" height="5.4" rx=".5" fill="#55a7ff" opacity=".7" /><text x="2.2" y="10.5" fill="currentColor" fontSize="9">あ</text><path {...common} d="M13 2.3v11.4M11.4 2.3h3.2M11.4 13.7h3.2" /></>
      case 'textHighlight':
        return <><rect x="1.5" y="5.2" width="13" height="6.2" rx=".6" fill="#ffd600" /><text x="3.5" y="11.5" fill="currentColor" fontSize="10">あ</text></>
      case 'underline':
        return <><text x="3.5" y="10.7" fill="currentColor" fontSize="10">あ</text><path d="M2.5 13h11" fill="none" stroke="#e03131" strokeWidth="1.8" strokeLinecap="round" /></>
      case 'strikeout':
        return <><text x="3.5" y="11" fill="currentColor" fontSize="10">あ</text><path d="M2.5 8h11" fill="none" stroke="#e03131" strokeWidth="1.8" strokeLinecap="round" /></>
    }
  })()

  return <svg className={`tool-icon ${className}`.trim()} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">{content}</svg>
}
