// Минимальный генератор .xlsx с настоящими диаграммами Excel (не картинками).
// Структура файлов повторяет вывод XlsxWriter, который Excel открывает без предупреждений.
// Модуль не зависит от Deno: на выходе — набор XML-файлов, архивирует их вызывающий код.
import { THEME_XML } from './theme.ts';

export type Style = 'text' | 'header' | 'title' | 'money' | 'moneyBold' | 'date' | 'qty' | 'bold' | 'muted';
export type Value = string | number | null;
export type Cell = Value | { v: Value; s: Style };

/** Диапазон ячеек, индексы с нуля, включительно. */
export type Range = { sheet: string; r1: number; c1: number; r2: number; c2: number };

export type Chart = {
  title: string;
  grouping: 'clustered' | 'stacked';
  categories: Range;
  series: { name: string; values: Range }[];
  legend: boolean;
  /** Положение: верхний левый и нижний правый угол в ячейках. */
  at: { col: number; row: number; toCol: number; toRow: number };
  valueFormat?: string;
};

export type Sheet = {
  name: string;
  rows: Cell[][];
  widths?: number[];
  freezeRows?: number;
  autoFilter?: { r1: number; c1: number; r2: number; c2: number };
  charts?: Chart[];
};

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const STYLE_INDEX: Record<Style, number> = {
  text: 0,
  header: 1,
  title: 2,
  money: 3,
  moneyBold: 4,
  date: 5,
  qty: 6,
  bold: 7,
  muted: 8,
};

export const MONEY_FORMAT = '#,##0.00\\ "₽"';

export function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function colName(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const ref = (r: number, c: number) => `${colName(c)}${r + 1}`;
const absRef = (r: number, c: number) => `$${colName(c)}$${r + 1}`;
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;
export const rangeFormula = (g: Range) => `${quoteSheet(g.sheet)}!${absRef(g.r1, g.c1)}:${absRef(g.r2, g.c2)}`;

/** Дата ГГГГ-ММ-ДД → число дней Excel. */
export function excelDate(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

function cellParts(cell: Cell): { v: Value; s: Style } {
  if (cell !== null && typeof cell === 'object') return cell;
  return { v: cell, s: 'text' };
}

function numStr(n: number): string {
  // без экспоненты и мусора плавающей точки: суммы в рублях имеют не больше 2 знаков, объёмы — 3
  return String(Math.round(n * 1e6) / 1e6);
}

class SharedStrings {
  list: string[] = [];
  index = new Map<string, number>();
  count = 0;
  id(s: string): number {
    this.count++;
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
  xml(): string {
    const items = this.list
      .map((s) => (/^\s|\s$/.test(s) ? `<si><t xml:space="preserve">${esc(s)}</t></si>` : `<si><t>${esc(s)}</t></si>`))
      .join('');
    return `${XML_HEAD}<sst xmlns="${NS_MAIN}" count="${this.count}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

function sheetXml(sheet: Sheet, sst: SharedStrings, selected: boolean, hasDrawing: boolean): string {
  const maxCols = Math.max(1, ...sheet.rows.map((r) => r.length));
  const dim = sheet.rows.length ? `A1:${ref(sheet.rows.length - 1, maxCols - 1)}` : 'A1';
  const pane = sheet.freezeRows
    ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="${ref(sheet.freezeRows, 0)}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
    : '';
  const cols = sheet.widths?.length
    ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const { v, s } = cellParts(cell);
          const st = STYLE_INDEX[s] ? ` s="${STYLE_INDEX[s]}"` : '';
          if (v === null || v === undefined || v === '') return st ? `<c r="${ref(r, c)}"${st}/>` : '';
          if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref(r, c)}"${st}><v>${numStr(v)}</v></c>` : '';
          return `<c r="${ref(r, c)}"${st} t="s"><v>${sst.id(v)}</v></c>`;
        })
        .join('');
      const ht = row.some((cell) => cellParts(cell).s === 'title') ? ' ht="21" customHeight="1"' : '';
      return `<row r="${r + 1}"${ht}>${cells}</row>`;
    })
    .join('');
  const af = sheet.autoFilter ? `<autoFilter ref="${ref(sheet.autoFilter.r1, sheet.autoFilter.c1)}:${ref(sheet.autoFilter.r2, sheet.autoFilter.c2)}"/>` : '';
  return (
    `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><dimension ref="${dim}"/>` +
    `<sheetViews><sheetView${selected ? ' tabSelected="1"' : ''} workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>${af}` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `${hasDrawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`
  );
}

function stylesXml(): string {
  return (
    `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="${esc(MONEY_FORMAT)}"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/></numFmts>` +
    `<fonts count="4">` +
    `<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>` +
    `<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>` +
    `<font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>` +
    `<font><i/><sz val="11"/><color rgb="FF6B6B6B"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>` +
    `</fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FFFDC300"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="9">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`
  );
}

function richText(text: string, size?: number): string {
  const sz = size ? ` sz="${size * 100}" b="1"` : '';
  return `<c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr${sz}/></a:pPr><a:r><a:rPr lang="ru-RU"${sz}/><a:t>${esc(text)}</a:t></a:r></a:p></c:rich>`;
}

function chartXml(chart: Chart, sheets: Sheet[], n: number): string {
  const values = (g: Range): Value[] => {
    const sh = sheets.find((s) => s.name === g.sheet);
    const out: Value[] = [];
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.push(sh ? cellParts(sh.rows[r]?.[c] ?? null).v : null);
    return out;
  };
  const cats = values(chart.categories);
  const catCache = `<c:strCache><c:ptCount val="${cats.length}"/>${cats
    .map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${esc(String(v))}</c:v></c:pt>`))
    .join('')}</c:strCache>`;
  const axCat = 50010000 + n * 10 + 1;
  const axVal = axCat + 1;
  const fmt = chart.valueFormat ?? 'General';
  const series = chart.series
    .map((s, i) => {
      const vals = values(s.values);
      const cache = `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${vals.length}"/>${vals
        .map((v, j) => (typeof v === 'number' ? `<c:pt idx="${j}"><c:v>${numStr(v)}</c:v></c:pt>` : ''))
        .join('')}</c:numCache>`;
      return (
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>` +
        `<c:invertIfNegative val="0"/>` +
        `<c:cat><c:strRef><c:f>${esc(rangeFormula(chart.categories))}</c:f>${catCache}</c:strRef></c:cat>` +
        `<c:val><c:numRef><c:f>${esc(rangeFormula(s.values))}</c:f>${cache}</c:numRef></c:val></c:ser>`
      );
    })
    .join('');
  const overlap = chart.grouping === 'stacked' ? '<c:overlap val="100"/>' : '';
  const legend = chart.legend ? '<c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend>' : '';
  return (
    `${XML_HEAD}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${NS_R}">` +
    `<c:lang val="ru-RU"/><c:chart><c:title><c:tx>${richText(chart.title, 14)}</c:tx><c:layout/><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="${chart.grouping}"/><c:varyColors val="0"/>` +
    `${series}<c:gapWidth val="80"/>${overlap}<c:axId val="${axCat}"/><c:axId val="${axVal}"/></c:barChart>` +
    `<c:catAx><c:axId val="${axCat}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>` +
    `<c:numFmt formatCode="General" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${axVal}"/><c:crosses val="autoZero"/>` +
    `<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
    `<c:valAx><c:axId val="${axVal}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/>` +
    `<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${axCat}"/><c:crosses val="autoZero"/>` +
    `<c:crossBetween val="between"/></c:valAx></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`
  );
}

function drawingXml(charts: Chart[], firstRelId: number): string {
  const anchors = charts
    .map(
      (ch, i) =>
        `<xdr:twoCellAnchor><xdr:from><xdr:col>${ch.at.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.at.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${ch.at.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${ch.at.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
        `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${NS_R}" r:id="rId${firstRelId + i}"/>` +
        `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`,
    )
    .join('');
  return `${XML_HEAD}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

const rels = (items: { id: string; type: string; target: string }[]) =>
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${items
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`)
    .join('')}</Relationships>`;

/** Все файлы книги: путь внутри архива → содержимое. */
export function buildXlsx(sheets: Sheet[], createdIso = new Date().toISOString()): Record<string, string> {
  const files: Record<string, string> = {};
  const sst = new SharedStrings();
  const overrides: string[] = [];
  let chartNo = 0;
  let drawingNo = 0;

  sheets.forEach((sheet, i) => {
    const charts = sheet.charts ?? [];
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet, sst, i === 0, charts.length > 0);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
    if (!charts.length) return;
    drawingNo++;
    files[`xl/worksheets/_rels/sheet${i + 1}.xml.rels`] = rels([{ id: 'rId1', type: `${REL}/drawing`, target: `../drawings/drawing${drawingNo}.xml` }]);
    files[`xl/drawings/drawing${drawingNo}.xml`] = drawingXml(charts, 1);
    overrides.push(`<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
    const drawingRels: { id: string; type: string; target: string }[] = [];
    charts.forEach((ch, j) => {
      chartNo++;
      files[`xl/charts/chart${chartNo}.xml`] = chartXml(ch, sheets, chartNo);
      overrides.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
      drawingRels.push({ id: `rId${j + 1}`, type: `${REL}/chart`, target: `../charts/chart${chartNo}.xml` });
    });
    files[`xl/drawings/_rels/drawing${drawingNo}.xml.rels`] = rels(drawingRels);
  });

  const definedNames = sheets
    .map((s, i) =>
      s.autoFilter
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(
            rangeFormula({ sheet: s.name, ...s.autoFilter }),
          )}</definedName>`
        : '',
    )
    .join('');
  files['xl/workbook.xml'] =
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><fileVersion appName="xl" lastEdited="4" lowestEdited="4" rupBuild="4505"/>` +
    `<workbookPr defaultThemeVersion="124226"/><bookViews><workbookView xWindow="240" yWindow="15" windowWidth="16095" windowHeight="9660"/></bookViews>` +
    `<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
    `${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}<calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>`;

  const n = sheets.length;
  files['xl/_rels/workbook.xml.rels'] = rels([
    ...sheets.map((_, i) => ({ id: `rId${i + 1}`, type: `${REL}/worksheet`, target: `worksheets/sheet${i + 1}.xml` })),
    { id: `rId${n + 1}`, type: `${REL}/theme`, target: 'theme/theme1.xml' },
    { id: `rId${n + 2}`, type: `${REL}/styles`, target: 'styles.xml' },
    { id: `rId${n + 3}`, type: `${REL}/sharedStrings`, target: 'sharedStrings.xml' },
  ]);
  files['xl/styles.xml'] = stylesXml();
  files['xl/theme/theme1.xml'] = THEME_XML;
  files['xl/sharedStrings.xml'] = sst.xml();
  files['_rels/.rels'] = rels([
    { id: 'rId1', type: `${REL}/officeDocument`, target: 'xl/workbook.xml' },
    { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
    { id: 'rId3', type: `${REL}/extended-properties`, target: 'docProps/app.xml' },
  ]);
  const created = createdIso.replace(/\.\d+Z$/, 'Z');
  files['docProps/core.xml'] =
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:creator>Учёт работ</dc:creator><cp:lastModifiedBy>Учёт работ</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
  files['docProps/app.xml'] =
    `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
    `<Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>` +
    `<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${n}</vt:i4></vt:variant></vt:vector></HeadingPairs>` +
    `<TitlesOfParts><vt:vector size="${n}" baseType="lpstr">${sheets.map((s) => `<vt:lpstr>${esc(s.name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>` +
    `<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>12.0000</AppVersion></Properties>`;
  files['[Content_Types].xml'] =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `${overrides.join('')}<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  return files;
}
