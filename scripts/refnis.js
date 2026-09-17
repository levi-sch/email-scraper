import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { load } from 'cheerio';

const zip = unzipSync(readFileSync(new URL('../resources/refnis-2025.xlsx', import.meta.url)));
const strings = [];
const $s = load(strFromU8(zip['xl/sharedStrings.xml']), { xml: true });
$s('si').each((_, el) => strings.push($s(el).find('t').map((_, t) => $s(t).text()).get().join('')));
const $ = load(strFromU8(zip['xl/worksheets/sheet1.xml']), { xml: true });
const rows = [];
$('row').each((_, row) => {
  const cells = [];
  $(row).find('c').each((_, c) => {
    const value = $(c).find('v').text(), reference = $(c).attr('r') || '';
    let index = 0;
    for (const letter of reference.replace(/\d/g, '')) index = index * 26 + letter.charCodeAt(0) - 64;
    cells[index - 1] = $(c).attr('t') === 's' ? strings[Number(value)] : $(c).attr('t') === 'inlineStr' ? $(c).find('t').text() : value;
  });
  rows.push(cells);
});
if (process.argv.includes('--inspect')) console.log(JSON.stringify(rows.slice(0, 12), null, 2));
else {
  const header = rows.shift();
  const data = rows.filter(r => r[0]).map(r => Object.fromEntries(header.map((h, i) => {
    let value = r[i] || '';
    if (h.startsWith('DT_') && /^\d+$/.test(value)) {
      const date = new Date(Date.UTC(1899, 11, 30) + Number(value) * 86400000);
      value = `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
    }
    return [h, value];
  })));
  writeFileSync(new URL('../resources/refnis-2025.json', import.meta.url), JSON.stringify(data));
  console.log(`${data.length} Statbel-rijen opgeslagen.`);
}
