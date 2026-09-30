const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const shortNames: Record<string, string> = { cn: '中国', hk: '香港', mo: '澳门', tw: '台湾' };
export const locations =
  'cn hk jp sg us tw de gb fr kr ca au nl ru fi se no ch in vn th my id mo ie it es pl br tr za ae nz is ua'
    .split(' ')
    .map((code) => ({
      code,
      label: shortNames[code] || regionNames.of(code.toUpperCase()) || code.toUpperCase(),
    }));
const aliases: Record<string, string> = {
  china: 'cn',
  chn: 'cn',
  中国: 'cn',
  中国大陆: 'cn',
  japan: 'jp',
  jpn: 'jp',
  日本: 'jp',
  hongkong: 'hk',
  hkg: 'hk',
  香港: 'hk',
  中国香港: 'hk',
  香港特别行政区: 'hk',
  macau: 'mo',
  macao: 'mo',
  澳门: 'mo',
  中国澳门: 'mo',
  taiwan: 'tw',
  台湾: 'tw',
  中国台湾: 'tw',
  singapore: 'sg',
  新加坡: 'sg',
  usa: 'us',
  unitedstates: 'us',
  美国: 'us',
  uk: 'gb',
  unitedkingdom: 'gb',
  英国: 'gb',
  korea: 'kr',
  southkorea: 'kr',
  韩国: 'kr',
};
export function resolveLocation(value?: string) {
  if (!value) return null;
  let code = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  const symbols = Array.from(code);
  if (
    symbols.length === 2 &&
    symbols.every((s) => s.codePointAt(0)! >= 0x1f1e6 && s.codePointAt(0)! <= 0x1f1ff)
  ) {
    code = symbols.map((s) => String.fromCharCode(s.codePointAt(0)! - 0x1f1e6 + 97)).join('');
  }
  code = aliases[code] || code;
  return (
    locations.find((location) => location.code === code || location.label.toLowerCase() === code) ||
    null
  );
}
