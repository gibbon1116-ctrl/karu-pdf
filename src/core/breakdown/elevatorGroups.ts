// 公共建築工事内訳書標準書式（設備工事編）令和8年3月改定の昇降機設備の細目別内訳（書式の PDF の 78〜82 頁）。
// 書式は記入例（１号機・２号機など）なので、号機の中科目を「号機」1つにまとめ、摘要の空欄（「定員　名」「　形　製、　仕上」）を区分名にして手で起こした。
// 発生材の3行は単位を ㎥（t を併記）にした。separate は「1式・別紙明細」、renovation は書式の ※。
import type { BreakdownGroupData } from './types'

export const ELEVATOR_GROUPS: readonly BreakdownGroupData[] = [
  { section: "庁舎", subject: "エレベーター設備", middle: "号機", rows: [
    { name: "主要機器、かご", summary: ["号機", "用途", "定員", "速度"], unit: "式" },
    { name: "その他部材", unit: "式", note: "点検用タラップ等" },
    { name: "共通部材", unit: "式", note: "中間ビーム等（複数号機の共通）" },
    { name: "三方枠", summary: ["形", "材質", "仕上"], unit: "か所" },
    { name: "幕板", summary: ["材質", "仕上"], unit: "か所" },
    { name: "乗場の敷居", summary: ["材質"], unit: "か所" },
    { name: "乗場の戸", summary: ["形式", "材質", "仕上"], unit: "か所" },
    { name: "乗場ボタン", summary: ["形式", "材質", "仕上"], unit: "か所" },
    { name: "専用乗場ボタン", summary: ["形式", "材質", "仕上"], unit: "か所" },
    { name: "インジケータ", summary: ["形式", "材質", "仕上"], unit: "か所" },
    { name: "電気配管配線", unit: "式", note: "機械室内、昇降路内" },
    { name: "消耗品雑材料", unit: "式" },
    { name: "労務費", unit: "式", note: "調整労務費を含む" },
    { name: "運搬費", unit: "式" },
    { name: "諸経費", unit: "式" },
    { name: "直接仮設", unit: "式", separate: true, renovation: true, note: "養生等" },
  ] },
  { section: "庁舎", subject: "エレベーター設備", middle: "エレベーター監視盤", rows: [
    { name: "エレベーター監視盤", summary: ["形式", "監視台数"], unit: "面", note: "インターホン含む" },
    { name: "消耗品雑材料", unit: "式" },
    { name: "労務費", unit: "式", note: "結線・試験調整費・調整労務費を含む" },
    { name: "運搬費", unit: "式" },
    { name: "諸経費", unit: "式" },
  ] },
  { section: "庁舎", subject: "小荷物専用昇降機設備", rows: [
    { name: "主要機器、かご", summary: ["積載重量", "速度"], unit: "式" },
    { name: "その他部材", unit: "式" },
    { name: "三方枠", summary: ["形", "材質", "仕上"], unit: "か所" },
    { name: "敷板または膳板", summary: ["材質", "仕上"], unit: "台" },
    { name: "敷居", summary: ["材質"], unit: "台" },
    { name: "出し入れ口戸", summary: ["形式", "材質", "仕上"], unit: "台" },
    { name: "操作盤", summary: ["形式", "材質", "仕上"], unit: "台" },
    { name: "電気配管配線", unit: "式" },
    { name: "消耗品雑材料", unit: "式" },
    { name: "労務費", unit: "式", note: "調整労務費を含む" },
    { name: "運搬費", unit: "式" },
    { name: "諸経費", unit: "式" },
  ] },
  { section: "庁舎", subject: "エスカレーター設備", rows: [
    { name: "エスカレーター", summary: ["号機", "形式", "傾斜角度", "速度"], unit: "台" },
    { name: "電気配管配線", unit: "式" },
    { name: "消耗品雑材料", unit: "式" },
    { name: "労務費", unit: "式", note: "調整労務費を含む" },
    { name: "運搬費", unit: "式" },
    { name: "諸経費", unit: "式" },
  ] },
  { section: "庁舎", subject: "撤去工事", rows: [
    { name: "号機撤去費", summary: ["号機"], unit: "式", renovation: true },
    { name: "諸経費", unit: "式", renovation: true },
  ] },
  { section: "庁舎", subject: "発生材処理", rows: [
    { name: "発生材積込", summary: ["種類", "積込方法"], unit: "㎥", renovation: true, note: "t を併記" },
    { name: "発生材運搬", summary: ["種類", "運搬車の種別", "運搬距離"], unit: "㎥", renovation: true, note: "t を併記" },
    { name: "発生材処分", summary: ["種類", "処分場所"], unit: "㎥", renovation: true, note: "t を併記" },
  ] },
]
