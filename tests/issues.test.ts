import { describe, expect, it } from 'vitest'
import { ISSUE_STATUSES, ISSUE_STATUS_CHOICES, issueStatusChoice, issueStatusLabel, issueColor, parseIssue, unresolvedIssue, type Issue, type IssueStatusChoice } from '../src/core/issues'
import type { RGB } from '../src/core/annotations'

const cases: Array<[Issue['status'], IssueStatusChoice, string, RGB]> = [
  ['open', 'open', '未回答', [1, 0, 0]],
  ['answered', 'answered', '回答済み', [0, .25, 1]],
  ['revised', 'answered', '回答済み', [0, .25, 1]],
  ['done', 'answered', '回答済み', [0, .25, 1]],
  ['confirmed', 'confirmed', '修正確認', [.5, .5, .5]],
]

describe('指摘の3状態と旧保存値', () => {
  it('読み込みは5値を受け付け、画面の選択肢は3値だけにする', () => {
    expect(ISSUE_STATUSES).toEqual(['open', 'answered', 'revised', 'confirmed', 'done'])
    expect(ISSUE_STATUS_CHOICES).toEqual(['open', 'answered', 'confirmed'])
  })
  it.each(cases)('%s の選択値・文言・色を読み替え、保存値は変えない', (status, choice, label, color) => {
    const issue = parseIssue(JSON.stringify({ number: 1, status }))!
    expect(issue).toEqual({ number: 1, status })
    expect(issueStatusChoice(issue.status)).toBe(choice)
    expect(issueStatusLabel(issue.status)).toBe(label)
    // A saved custom color must not override the status color.
    expect(issueColor(issue, [0, 1, 0])).toEqual(color)
    expect(unresolvedIssue(issue)).toBe(status !== 'confirmed')
    expect(issue.status).toBe(status)
  })
})
