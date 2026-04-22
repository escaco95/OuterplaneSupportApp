/**
 * Canonical list of all stat display strings that can appear in the 정밀 제작
 * To-Be panel. Each entry is the exact string the scan pipeline produces when
 * name and pct marker both match (with "%" suffix iff the stat is a percentage).
 *
 * Adding new stats here is a deliberate, dev-reviewed change: if the game
 * introduces a stat not in this catalog, the scan pipeline treats it as
 * detection failure (UNKNOWN) and the auto-reroll UI surfaces an "인식 실패"
 * error expecting a support ticket / app update.
 *
 * The count (13) matches the combinatorial model used elsewhere for Pattern
 * A/B probability calculations — do not add speculative entries.
 */
export const STAT_CATALOG = [
  '체력',
  '체력%',
  '공격력',
  '공격력%',
  '방어력',
  '방어력%',
  '속도',
  '치명 확률%',
  '치명 피해%',
  '효과 적중%',
  '효과 저항%',
  '피해 증가%',
  '받는 피해 감소%',
] as const;

export type StatName = (typeof STAT_CATALOG)[number];

const CATALOG_SET = new Set<string>(STAT_CATALOG);

export function isKnownStat(s: string | null | undefined): s is StatName {
  return typeof s === 'string' && CATALOG_SET.has(s);
}
