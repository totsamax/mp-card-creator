import { useState, useEffect, useCallback } from 'react';
import {
  Layers, Type, Image as ImageIcon, Film, FileSpreadsheet, Folder,
  ChevronDown, RotateCcw, Plus, Upload, Check, Play, Download, X,
} from 'lucide-react';

// Base URL for API Gateway. Set VITE_API_BASE_URL in .env to point at the deployed gateway.
// Empty string → same origin (works when frontend is served by the api function locally).
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ?? '';

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}`);
  return res.json();
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

:root {
  --paper: #F6F1EA;
  --ink: #2B2632;
  --muted: #948C99;
  --line: #E2DACE;
  --lavender: #8E7CC3;
  --lavender-soft: #ECE7F7;
  --lavender-dark: #5B4D96;
  --clay: #CC7A52;
  --clay-soft: #F6E3D8;
  --clay-dark: #8C4B2E;
  --sage: #7E9B7E;
  --sage-soft: #E6EDE3;
  --sage-dark: #4F6B4F;
}
.pp-root { font-family: 'Inter', sans-serif; background: var(--paper); color: var(--ink); }
.pp-display { font-family: 'Fraunces', serif; }
.pp-mono { font-family: 'IBM Plex Mono', monospace; }
.pp-card { background: #fff; border: 1px solid var(--line); }
.pp-muted { color: var(--muted); }
.pp-line { border-color: var(--line); }
.pp-input, .pp-select, .pp-textarea {
  font-family: 'Inter', sans-serif; font-size: 13px; border: 1px solid var(--line);
  background: #fff; border-radius: 6px; padding: 7px 10px; width: 100%; color: var(--ink);
}
.pp-input:focus, .pp-select:focus, .pp-textarea:focus { outline: 2px solid var(--lavender); border-color: var(--lavender); }
.pp-label { font-size: 12px; font-weight: 500; color: var(--muted); display: block; margin-bottom: 4px; }
.pp-btn {
  font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 500; border-radius: 6px;
  padding: 8px 14px; border: 1px solid var(--line); background: #fff; color: var(--ink);
  cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
}
.pp-btn:hover { background: var(--paper); }
.pp-btn-primary { background: var(--lavender); color: #fff; border-color: var(--lavender); }
.pp-btn-primary:hover { background: var(--lavender-dark); }
.pp-btn-ghost { border: none; background: transparent; padding: 4px; }
.pp-btn-ghost:hover { background: var(--lavender-soft); }
`;

const STEPS = [
  { key: 'normalize', code: '01', label: 'Нормализация', icon: Layers },
  { key: 'texts', code: '02', label: 'Тексты', icon: Type },
  { key: 'images', code: '03', label: 'Изображения', icon: ImageIcon },
  { key: 'video', code: '04', label: 'Видео', icon: Film },
  { key: 'excel', code: '05', label: 'Excel-выгрузка', icon: FileSpreadsheet },
  { key: 'assemble', code: '06', label: 'Сборка пакета', icon: Folder },
];

const ALL_SIZES = ['XS', 'S', 'M', 'L', 'XL'];

const LINES = [
  { id: '0553', name: 'Василиса', theme: 'Личико ангелочка', color: 'Лавандовый', status: 'active', sizes: ['XS', 'S', 'M', 'L', 'XL'] },
  { id: '0612', name: 'Гномик', theme: 'Бородатый гномик', color: 'Тёплый бежевый', status: 'done', sizes: ['XS', 'S', 'M', 'L', 'XL'] },
  { id: '0588', name: 'Ёжик', theme: 'Лесной ёжик', color: 'Карамельный', status: 'draft', sizes: ['S', 'M', 'L'] },
];

const STATUS_LABEL = { active: 'В работе', done: 'Готово', draft: 'Черновик' };
const STATUS_CLASS = { active: 'bg-lavender-soft text-lavender-dark', done: 'bg-sage-soft text-sage-dark', draft: 'bg-clay-soft text-clay-dark' };

const MASTER_DATA = {
  '0553': {
    rows: [
      { label: 'Размер личика, см', unit: '', values: { XS: 2, S: 3, M: 4, L: 5, XL: 6 } },
      { label: 'Длина молда, см', unit: '', values: { XS: 3, S: 4.5, M: 6, L: 7.5, XL: 9 } },
      { label: 'Ширина молда, см', unit: '', values: { XS: 1.25, S: 1.875, M: 2.5, L: 3.125, XL: 3.75 } },
      { label: 'Высота молда, см', unit: '', values: { XS: 2.5, S: 3.75, M: 5, L: 6.25, XL: 7.5 } },
      { label: 'Вес молда, г', unit: '', values: { XS: 10, S: 30, M: 60, L: 105, XL: 165 } },
      { label: 'Вес с упаковкой, г', unit: '', values: { XS: 50, S: 70, M: 100, L: 145, XL: 205 } },
      { label: 'Цена базовая, ₽', unit: '', values: { XS: 350, S: 650, M: 1000, L: 1400, XL: 1850 } },
      { label: 'Цена со скидкой, ₽', unit: '', values: { XS: 260, S: 490, M: 750, L: 1050, XL: 1390 } },
    ],
  },
  '0612': {
    rows: [
      { label: 'Размер личика, см', unit: '', values: { XS: 2, S: 3, M: 4, L: 5, XL: 6 } },
      { label: 'Длина молда, см', unit: '', values: { XS: 2.8, S: 4.2, M: 5.6, L: 7, XL: 8.4 } },
      { label: 'Ширина молда, см', unit: '', values: { XS: 1.4, S: 2.1, M: 2.8, L: 3.5, XL: 4.2 } },
      { label: 'Высота молда, см', unit: '', values: { XS: 2.2, S: 3.3, M: 4.4, L: 5.5, XL: 6.6 } },
      { label: 'Вес молда, г', unit: '', values: { XS: 12, S: 32, M: 65, L: 110, XL: 170 } },
      { label: 'Вес с упаковкой, г', unit: '', values: { XS: 52, S: 72, M: 105, L: 150, XL: 210 } },
      { label: 'Цена базовая, ₽', unit: '', values: { XS: 380, S: 690, M: 1050, L: 1450, XL: 1900 } },
      { label: 'Цена со скидкой, ₽', unit: '', values: { XS: 285, S: 520, M: 790, L: 1090, XL: 1425 } },
    ],
  },
  '0588': {
    rows: [
      { label: 'Размер личика, см', unit: '', values: { S: 3, M: 4, L: 5 } },
      { label: 'Длина молда, см', unit: '', values: { S: 4.5, M: 6, L: 7.5 } },
      { label: 'Ширина молда, см', unit: '', values: { S: 1.9, M: 2.5, L: 3.1 } },
      { label: 'Высота молда, см', unit: '', values: { S: 3.8, M: 5, L: 6.3 } },
      { label: 'Вес молда, г', unit: '', values: { S: 28, M: 58, L: 100 } },
      { label: 'Вес с упаковкой, г', unit: '', values: { S: 68, M: 98, L: 140 } },
      { label: 'Цена базовая, ₽', unit: '', values: { S: 600, M: 950, L: 1350 } },
      { label: 'Цена со скидкой, ₽', unit: '', values: { S: 450, M: 710, L: 1010 } },
    ],
  },
};

const TEXTS = {
  '0553': {
    XS: { title: 'Молд «Василиса» 2см #ТопМолд', annotation: 'Авторский силиконовый молд для отливки личика ватной игрушки или куклы. Глаза без зрачков — расписывайте сами. Личико 2 см.' },
    S: { title: 'Молд «Василиса» 3см #ТопМолд', annotation: 'Авторский силиконовый молд для отливки личика ватной игрушки или куклы. Глаза без зрачков — расписывайте сами. Личико 3 см.' },
    M: { title: 'Молд «Василиса» 4см #ТопМолд', annotation: 'Авторский силиконовый молд для отливки личика ватной игрушки или куклы. Глаза без зрачков — расписывайте сами. Личико 4 см.' },
    L: { title: 'Молд «Василиса» 5см #ТопМолд', annotation: 'Авторский силиконовый молд для отливки личика ватной игрушки или куклы. Глаза без зрачков — расписывайте сами. Личико 5 см.' },
    XL: { title: 'Молд «Василиса» 6см #ТопМолд', annotation: 'Авторский силиконовый молд для отливки личика ватной игрушки или куклы. Глаза без зрачков — расписывайте сами. Личико 6 см.' },
  },
  '0612': {
    XS: { title: 'Молд «Гномик» 2см #ТопМолд', annotation: 'Силиконовый молд для отливки личика гномика — борода и нос проработаны рельефом. Личико 2 см.' },
    S: { title: 'Молд «Гномик» 3см #ТопМолд', annotation: 'Силиконовый молд для отливки личика гномика — борода и нос проработаны рельефом. Личико 3 см.' },
    M: { title: 'Молд «Гномик» 4см #ТопМолд', annotation: 'Силиконовый молд для отливки личика гномика — борода и нос проработаны рельефом. Личико 4 см.' },
    L: { title: 'Молд «Гномик» 5см #ТопМолд', annotation: 'Силиконовый молд для отливки личика гномика — борода и нос проработаны рельефом. Личико 5 см.' },
    XL: { title: 'Молд «Гномик» 6см #ТопМолд', annotation: 'Силиконовый молд для отливки личика гномика — борода и нос проработаны рельефом. Личико 6 см.' },
  },
  '0588': {
    S: { title: 'Молд «Ёжик» 3см #ТопМолд', annotation: 'Силиконовый молд для отливки личика ёжика — иголки переданы мелким рельефом. Личико 3 см.' },
    M: { title: 'Молд «Ёжик» 4см #ТопМолд', annotation: 'Силиконовый молд для отливки личика ёжика — иголки переданы мелким рельефом. Личико 4 см.' },
    L: { title: 'Молд «Ёжик» 5см #ТопМолд', annotation: 'Силиконовый молд для отливки личика ёжика — иголки переданы мелким рельефом. Личико 5 см.' },
  },
};

const IMAGE_TYPES = [
  { key: 'main', label: 'Главное фото' },
  { key: 'infographic', label: 'Инфографика с размерами' },
  { key: 'scale', label: 'Масштаб с игрушкой' },
  { key: 'lifestyle', label: 'Лайфстайл' },
];

const IMAGES = {
  '0553': { XS: { main: 2, infographic: 1, scale: 1, lifestyle: 0 }, S: { main: 2, infographic: 1, scale: 1, lifestyle: 1 }, M: { main: 2, infographic: 2, scale: 1, lifestyle: 1 }, L: { main: 1, infographic: 1, scale: 1, lifestyle: 0 }, XL: { main: 1, infographic: 1, scale: 0, lifestyle: 0 } },
  '0612': { XS: { main: 1, infographic: 1, scale: 1, lifestyle: 1 }, S: { main: 1, infographic: 1, scale: 1, lifestyle: 1 }, M: { main: 1, infographic: 1, scale: 1, lifestyle: 1 }, L: { main: 1, infographic: 1, scale: 1, lifestyle: 1 }, XL: { main: 1, infographic: 1, scale: 1, lifestyle: 1 } },
  '0588': { S: { main: 0, infographic: 0, scale: 0, lifestyle: 0 }, M: { main: 1, infographic: 0, scale: 0, lifestyle: 0 }, L: { main: 0, infographic: 0, scale: 0, lifestyle: 0 } },
};

const VIDEO = {
  '0553': { XS: { ready: false }, S: { ready: true, duration: '0:08' }, M: { ready: true, duration: '0:11' }, L: { ready: true, duration: '0:09' }, XL: { ready: false } },
  '0612': { XS: { ready: true, duration: '0:10' }, S: { ready: true, duration: '0:10' }, M: { ready: true, duration: '0:12' }, L: { ready: true, duration: '0:09' }, XL: { ready: true, duration: '0:10' } },
  '0588': { S: { ready: false }, M: { ready: false }, L: { ready: false } },
};

const VERSIONS = {
  '0553': {
    normalize: [{ v: 1, note: 'первичный расчёт по личику 4 см', date: '02 июн' }, { v: 2, note: 'обновлена базовая цена 1000 ₽', date: '06 июн' }],
    texts: [{ v: 1, note: 'тексты по шаблону «Ozon-карточка»', date: '03 июн' }],
    images: [{ v: 1, note: 'первая генерация по рендеру', date: '04 июн' }, { v: 2, note: 'перегенерирована инфографика M', date: '07 июн' }],
    video: [{ v: 1, note: 'ролики для S, M, L', date: '08 июн' }],
    excel: [{ v: 1, note: 'выгрузка Ozon + WB', date: '09 июн' }],
    assemble: [{ v: 1, note: 'сборка пакета по артикулу 0553', date: '09 июн' }],
  },
  '0612': {
    normalize: [{ v: 1, note: 'первичный расчёт', date: '28 мая' }],
    texts: [{ v: 1, note: 'тексты по шаблону', date: '28 мая' }],
    images: [{ v: 1, note: 'полный комплект изображений', date: '29 мая' }],
    video: [{ v: 1, note: 'ролики для всех размеров', date: '30 мая' }],
    excel: [{ v: 1, note: 'выгрузка Ozon + WB', date: '30 мая' }],
    assemble: [{ v: 1, note: 'сборка пакета по артикулу 0612', date: '30 мая' }],
  },
  '0588': {
    normalize: [{ v: 1, note: 'черновой расчёт по личику 4 см', date: '10 июн' }],
    texts: [{ v: 1, note: 'черновые тексты, требуют правки', date: '10 июн' }],
    images: [{ v: 1, note: 'один тестовый рендер', date: '11 июн' }],
    video: [],
    excel: [],
    assemble: [],
  },
};

const ASSEMBLE_TREE = {
  '0553': `0553/
├── manifest.json
├── master-data/v2.json
├── texts/v1/
├── images/v2/  (+ override: M_infographic v2)
├── video/v1/   (S, M, L)
├── excel/v1/0553_ozon.xlsx
├── excel/v1/0553_wb.xlsx
└── current/ → v2, v1, v2, v1, v1`,
  '0612': `0612/
├── manifest.json
├── master-data/v1.json
├── texts/v1/
├── images/v1/  (5 размеров × 4 типа)
├── video/v1/   (5 размеров)
├── excel/v1/0612_ozon.xlsx
├── excel/v1/0612_wb.xlsx
└── current/ → v1, v1, v1, v1, v1`,
  '0588': `0588/
├── manifest.json
├── master-data/v1.json
├── texts/v1/   (требует правки)
├── images/v1/  (1 тестовый файл)
├── video/      — нет данных
├── excel/      — нет данных
└── current/ → v1, v1, v1, —, —`,
};

function SizeLadder({ sizes, dim = 4 }) {
  const heights = { XS: 6, S: 9, M: 12, L: 15, XL: 18 };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
      {ALL_SIZES.map((s) => {
        const active = sizes.includes(s);
        return (
          <div
            key={s}
            style={{
              width: dim,
              height: heights[s],
              borderRadius: 1,
              background: active ? 'var(--lavender)' : 'transparent',
              border: active ? 'none' : '1px solid var(--line)',
            }}
          />
        );
      })}
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function VersionPicker({ versions, value, onChange, onRegenerate }) {
  if (!versions || versions.length === 0) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm pp-muted">Шаг ещё не запускался</span>
        <button className="pp-btn pp-btn-primary" onClick={onRegenerate}>
          <Play size={14} aria-hidden="true" /> Запустить шаг
        </button>
      </div>
    );
  }
  const current = versions.find((x) => x.v === value) || versions[versions.length - 1];
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative">
        <select
          className="pp-select pp-mono"
          style={{ width: 'auto', paddingRight: 28, appearance: 'none' }}
          value={current.v}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {versions.map((ver) => (
            <option key={ver.v} value={ver.v}>v{ver.v} · {ver.date}</option>
          ))}
        </select>
        <ChevronDown size={14} style={{ position: 'absolute', right: 8, top: 9, pointerEvents: 'none' }} aria-hidden="true" />
      </div>
      <span className="text-sm pp-muted">{current.note}</span>
      <button className="pp-btn" onClick={onRegenerate}>
        <RotateCcw size={14} aria-hidden="true" /> Перегенерировать
      </button>
    </div>
  );
}

const NORMALIZE_FIELDS = [
  { key: 'moldSize',     label: 'Размер молда, см' },
  { key: 'moldLength',   label: 'Длина молда, см' },
  { key: 'moldWidth',    label: 'Ширина молда, см' },
  { key: 'moldHeight',   label: 'Высота молда, см' },
  { key: 'moldWeight',   label: 'Вес молда, г' },
  { key: 'weightPacked', label: 'Вес с упаковкой, г' },
  { key: 'priceBase',    label: 'Цена базовая, ₽' },
  { key: 'priceDiscount',label: 'Цена со скидкой, ₽' },
  { key: 'toyFrom',      label: 'Игрушка от, см' },
  { key: 'toyTo',        label: 'Игрушка до, см' },
];

function apiArrayToRows(arr) {
  return NORMALIZE_FIELDS.map(({ key, label }) => ({
    label,
    values: Object.fromEntries(arr.map(r => [r.size, r[key]])),
  }));
}

function NormalizeView({ line, manifest }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    const stepMeta = manifest?.steps?.['01-normalize'];
    if (stepMeta) {
      apiFetch(`/lines/${line.id}/steps/01-normalize`)
        .then(res => {
          const arr = res.data?.['master-data.json'];
          if (Array.isArray(arr)) setRows(apiArrayToRows(arr));
        })
        .catch(() => {});
    } else {
      // Fall back to mock for demo lines
      const mock = MASTER_DATA[line.id];
      setRows(mock?.rows ?? null);
    }
  }, [line.id, manifest]);

  if (!rows) {
    return <p className="text-sm pp-muted p-4">Мастер-данные ещё не созданы. Нажмите «Запустить шаг».</p>;
  }

  return (
    <div className="pp-card rounded-lg overflow-hidden">
      <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="pp-line border-b">
            <th className="text-left p-3 font-medium pp-muted" style={{ minWidth: 180 }}>Параметр</th>
            {ALL_SIZES.map((s) => (
              <th
                key={s}
                className={`p-3 text-right font-medium pp-mono ${line.sizes.includes(s) ? '' : 'pp-muted'}`}
                style={{ background: s === 'M' && line.sizes.includes(s) ? 'var(--lavender-soft)' : 'transparent' }}
              >
                {s}{s === 'M' ? ' ·' : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.label} style={{ borderTop: '1px solid var(--line)', background: i % 2 ? 'transparent' : 'transparent' }}>
              <td className="p-3 pp-muted">{row.label}</td>
              {ALL_SIZES.map((s) => (
                <td
                  key={s}
                  className="p-3 text-right pp-mono"
                  style={{ background: s === 'M' && line.sizes.includes(s) ? 'var(--lavender-soft)' : 'transparent' }}
                >
                  {row.values[s] !== undefined ? row.values[s] : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextsView({ line, manifest }) {
  const [textsData, setTextsData] = useState(null);

  useEffect(() => {
    const stepMeta = manifest?.steps?.['02-texts'];
    if (stepMeta) {
      apiFetch(`/lines/${line.id}/steps/02-texts`)
        .then(res => {
          const bySize = {};
          for (const [name, payload] of Object.entries(res.data || {})) {
            const size = name.replace('_texts.json', '');
            bySize[size] = payload.texts || payload;
          }
          setTextsData(bySize);
        })
        .catch(() => {});
    } else {
      setTextsData(TEXTS[line.id] || {});
    }
  }, [line.id, manifest]);

  const texts = textsData || TEXTS[line.id] || {};
  return (
    <div className="grid grid-cols-1 gap-3">
      {line.sizes.map((s) => {
        const t = texts[s];
        return (
          <div key={s} className="pp-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="pp-mono text-xs px-2 py-0.5 rounded-md bg-lavender-soft text-lavender-dark">{s}</span>
              {t ? <span className="text-sm font-medium">{t.titleShort || t.title}</span> : <span className="text-sm pp-muted">нет данных</span>}
            </div>
            {t && <p className="text-sm pp-muted" style={{ lineHeight: 1.6 }}>{t.annotation}</p>}
            {t?.titleFull && t.titleFull !== t.titleShort && (
              <p className="text-xs pp-muted mt-2" style={{ lineHeight: 1.5, borderTop: '1px solid var(--line)', paddingTop: 8 }}>{t.titleFull}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ImagesView({ line, manifest, onRegenItem }) {
  const imgMeta = manifest?.steps?.['03-images'];
  const history = imgMeta?.history || [];

  // Build map: { 'M_main': { version, needsReview }, ... }
  const done = {};
  for (const h of history) {
    const key = `${h.size}_${h.imageType}`;
    if (!done[key] || h.version > done[key].version) done[key] = h;
  }

  const imgUrl = (size, imageType) => {
    const h = done[`${size}_${imageType}`];
    if (!h) return null;
    return `/lines/${line.id}/steps/03-images/artifacts/${size}_${imageType}.png?version=${h.version}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {line.sizes.map((s) => (
        <div key={s} className="pp-card rounded-lg p-4">
          <div className="pp-mono text-xs px-2 py-0.5 rounded-md bg-lavender-soft text-lavender-dark inline-block mb-3">{s}</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            {IMAGE_TYPES.map((type) => {
              const url  = imgUrl(s, type.key);
              const meta = done[`${s}_${type.key}`];
              return (
                <div key={type.key} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                  <div className="relative" style={{ aspectRatio: '1', background: 'var(--paper)' }}>
                    {url
                      ? <img src={url} alt={`${s} ${type.label}`} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={24} className="pp-muted" aria-hidden="true" /></div>
                    }
                    {meta?.needsReview && <span className="absolute top-1 right-1 text-xs bg-yellow-100 text-yellow-800 px-1 rounded">проверить</span>}
                  </div>
                  <div className="p-2 flex items-center justify-between">
                    <span className="text-xs pp-muted">{type.label}</span>
                    <button className="pp-btn-ghost" onClick={() => onRegenItem(line.id, s, type.key)} aria-label={`Перегенерировать ${type.label} для ${s}`}>
                      <RotateCcw size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!imgMeta && <p className="text-sm pp-muted">Изображения ещё не генерировались. Нажмите «Перегенерировать».</p>}
    </div>
  );
}

function VideoView({ line, onRegenItem }) {
  const data = VIDEO[line.id] || {};
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
      {line.sizes.map((s) => {
        const v = data[s] || { ready: false };
        return (
          <div key={s} className="pp-card rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="pp-mono text-xs px-2 py-0.5 rounded-md bg-lavender-soft text-lavender-dark">{s}</span>
              <button className="pp-btn-ghost" onClick={() => onRegenItem(line.id, s)} aria-label={`Перегенерировать видео для ${s}`}>
                <RotateCcw size={13} aria-hidden="true" />
              </button>
            </div>
            <div className="rounded-md flex items-center justify-center mb-2" style={{ height: 80, background: v.ready ? 'var(--lavender-soft)' : 'var(--paper)', border: '1px solid var(--line)' }}>
              {v.ready ? <Play size={20} className="text-lavender-dark" aria-hidden="true" /> : <span className="text-xs pp-muted">нет видео</span>}
            </div>
            <div className="text-xs pp-muted">{v.ready ? `kling.ai · ${v.duration}` : 'ожидает генерации'}</div>
          </div>
        );
      })}
    </div>
  );
}

function ExcelView({ line }) {
  const ver = VERSIONS[line.id]?.excel?.[0];
  if (!ver) {
    return <div className="pp-card rounded-lg p-6 text-center text-sm pp-muted">Выгрузка ещё не сформирована</div>;
  }
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      {['Ozon', 'Wildberries'].map((mp) => (
        <div key={mp} className="pp-card rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium mb-1">{mp}</div>
            <div className="text-xs pp-muted pp-mono">{line.id}_{mp.toLowerCase().slice(0, 4)}.xlsx</div>
            <div className="text-xs pp-muted mt-1">{line.sizes.length} строк · {ver.date}</div>
          </div>
          <button className="pp-btn" aria-label={`Скачать выгрузку для ${mp}`}>
            <Download size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AssembleView({ line }) {
  return (
    <div className="pp-card rounded-lg p-4">
      <pre className="pp-mono text-xs" style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0 }}>{ASSEMBLE_TREE[line.id]}</pre>
    </div>
  );
}

// Returns { state: 'idle'|'partial'|'review'|'done', label?: string }
function computeStepStatus(stepKey, manifest, lineSizes) {
  const stepId   = STEP_KEY_TO_ID[stepKey];
  const stepMeta = manifest?.steps?.[stepId];
  if (!stepMeta) return { state: 'idle' };

  const history = stepMeta.history || [];

  if (stepKey === 'texts') {
    const latest = {};
    for (const h of history) latest[h.size] = h;
    const done  = Object.keys(latest).length;
    const total = (lineSizes || ALL_SIZES).length;
    const review = Object.values(latest).some(h => h.needsReview);
    if (review)       return { state: 'review',  label: `${done}/${total}` };
    if (done < total) return { state: 'partial', label: `${done}/${total}` };
    return { state: 'done', label: `${done}/${total}` };
  }

  if (stepKey === 'images') {
    const latest = {};
    for (const h of history) {
      const key = `${h.size}_${h.imageType}`;
      if (!latest[key] || h.version > latest[key].version) latest[key] = h;
    }
    const done  = Object.keys(latest).length;
    const total = (lineSizes || ALL_SIZES).length * 4;
    const review = Object.values(latest).some(h => h.needsReview);
    if (review)       return { state: 'review',  label: `${done}/${total}` };
    if (done < total) return { state: 'partial', label: `${done}/${total}` };
    return { state: 'done', label: `${done}/${total}` };
  }

  return { state: 'done' };
}

const STATE_INDICATOR = {
  done:    ({ label }) => <Check size={12} style={{ color: 'var(--sage-dark)', flexShrink: 0 }} aria-hidden="true" />,
  partial: ({ label }) => <span style={{ fontSize: 10, color: 'var(--clay)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{label}</span>,
  review:  ({ label }) => <span style={{ fontSize: 10, color: 'var(--clay-dark)', flexShrink: 0 }}>⚠{label ? ` ${label}` : ''}</span>,
  idle:    () => null,
};

function StepperNav({ active, onSelect, lineId, manifests, line }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const Icon      = step.icon;
        const isActive  = step.key === active;
        const manifest  = manifests?.[lineId];
        const status    = computeStepStatus(step.key, manifest, line?.sizes);
        const Indicator = STATE_INDICATOR[status.state];
        return (
          <div key={step.key} className="flex items-center">
            <button
              onClick={() => onSelect(step.key)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
              style={{
                background:  isActive ? 'var(--lavender)' : 'transparent',
                color:       isActive ? '#fff' : status.state === 'idle' ? 'var(--muted)' : 'var(--ink)',
                border:      '1px solid transparent',
                borderColor: isActive ? 'var(--lavender)' : 'var(--line)',
                whiteSpace:  'nowrap',
              }}
            >
              <span className="pp-mono text-xs" style={{ opacity: 0.7 }}>{step.code}</span>
              <Icon size={14} aria-hidden="true" />
              {step.label}
              {!isActive && <Indicator label={status.label} />}
            </button>
            {i < STEPS.length - 1 && <div style={{ width: 12, height: 1, background: 'var(--line)' }} />}
          </div>
        );
      })}
    </div>
  );
}

const SIZE_DEFAULTS = {
  XS: { moldSize: 2,   moldLength: 3,   moldWidth: 1.25, moldHeight: 2.5,  moldWeight: 7   },
  S:  { moldSize: 3,   moldLength: 4.5, moldWidth: 1.9,  moldHeight: 3.75, moldWeight: 25  },
  M:  { moldSize: 4,   moldLength: 6,   moldWidth: 2.5,  moldHeight: 5,    moldWeight: 60  },
  L:  { moldSize: 5,   moldLength: 7.5, moldWidth: 3.1,  moldHeight: 6.25, moldWeight: 117 },
  XL: { moldSize: 6,   moldLength: 9,   moldWidth: 3.75, moldHeight: 7.5,  moldWeight: 202 },
};

const SIZE_FIELDS = [
  { key: 'moldSize',   label: 'Размер, см' },
  { key: 'moldLength', label: 'Длина, см' },
  { key: 'moldWidth',  label: 'Ширина, см' },
  { key: 'moldHeight', label: 'Высота, см' },
  { key: 'moldWeight', label: 'Вес, г' },
];

function QuestionnaireForm({ onSubmit, loading }) {
  const [form, setForm] = useState({
    moldName: '', article: '', brand: 'ТопМолд', theme: '', color: '', priceBaseM: 1000,
    moldType: 'face',
    sizes: ALL_SIZES.map(size => ({ size, ...SIZE_DEFAULTS[size] })),
    artifacts: { images: true, video: true, ozon: true, wb: true },
  });
  const [photoFiles, setPhotoFiles] = useState([]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleArtifact = (key) => setForm((f) => ({ ...f, artifacts: { ...f.artifacts, [key]: !f.artifacts[key] } }));
  const setSize = (size, field, value) => setForm((f) => ({
    ...f,
    sizes: f.sizes.map(r => r.size === size ? { ...r, [field]: parseFloat(value) || 0 } : r),
  }));

  const buildQuestionnaire = () => ({
    moldName:   form.moldName,
    article:    form.article,
    brand:      form.brand,
    theme:      form.theme,
    color:      form.color,
    priceBaseM: Number(form.priceBaseM),
    moldType:   form.moldType,
    sizes:      form.sizes,
    artifacts:  [
      form.artifacts.images && 'images',
      form.artifacts.video  && 'video',
      form.artifacts.ozon   && 'excel-ozon',
      form.artifacts.wb     && 'excel-wb',
    ].filter(Boolean),
  });

  return (
    <div className="pp-card rounded-lg p-5 max-w-3xl">
      <h2 className="pp-display text-lg mb-1" style={{ fontWeight: 500 }}>Новая линейка молда</h2>
      <p className="text-sm pp-muted mb-4">Заполните поля — пайплайн посчитает цены и тексты, физические параметры задайте вручную.</p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="pp-label">Имя молда</label>
          <input className="pp-input" placeholder="напр. Василиса" value={form.moldName} onChange={(e) => set('moldName', e.target.value)} />
        </div>
        <div>
          <label className="pp-label">Артикульная серия</label>
          <input className="pp-input pp-mono" placeholder="напр. 0553" value={form.article} onChange={(e) => set('article', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="pp-label">Бренд</label>
          <input className="pp-input" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
        </div>
        <div>
          <label className="pp-label">Цвет силикона</label>
          <input className="pp-input" placeholder="напр. Лавандовый" value={form.color} onChange={(e) => set('color', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="pp-label">Тип молда</label>
          <select className="pp-select" value={form.moldType} onChange={(e) => set('moldType', e.target.value)}>
            <option value="face">Лицо</option>
            <option value="hands">Руки</option>
            <option value="shoes">Обувь</option>
            <option value="other">Другое</option>
          </select>
        </div>
        <div>
          <label className="pp-label">Тема / персонаж</label>
          <input className="pp-input" placeholder="напр. ангелочек, кудрявая прядь" value={form.theme} onChange={(e) => set('theme', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="pp-label">Базовая цена за размер M, ₽</label>
          <input type="number" className="pp-input" value={form.priceBaseM} onChange={(e) => set('priceBaseM', e.target.value)} />
        </div>
      </div>

      {/* Sizes table */}
      <div className="mb-4">
        <label className="pp-label mb-2">Физические параметры по размерам</label>
        <div className="pp-card rounded-lg overflow-hidden">
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th className="p-2 text-left pp-muted font-medium" style={{ width: 40 }}>Размер</th>
                {SIZE_FIELDS.map(f => (
                  <th key={f.key} className="p-2 text-right pp-muted font-medium text-xs">{f.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.sizes.map((row) => (
                <tr key={row.size} style={{ borderTop: '1px solid var(--line)', background: row.size === 'M' ? 'var(--lavender-soft)' : 'transparent' }}>
                  <td className="p-2 pp-mono text-xs font-medium">{row.size}</td>
                  {SIZE_FIELDS.map(f => (
                    <td key={f.key} className="p-1">
                      <input
                        type="number"
                        step="0.01"
                        className="pp-input pp-mono text-right"
                        style={{ padding: '4px 6px', fontSize: 12 }}
                        value={row[f.key]}
                        onChange={(e) => setSize(row.size, f.key, e.target.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mb-4">
        <label className="pp-label">Фото молда</label>
        <input
          type="file"
          multiple
          accept="image/*"
          className="pp-input"
          onChange={(e) => setPhotoFiles(Array.from(e.target.files || []))}
        />
        {photoFiles.length > 0 && (
          <span className="text-xs pp-muted mt-1" style={{ display: 'block' }}>{photoFiles.length} файл(ов) выбрано</span>
        )}
      </div>

      <div className="mb-5">
        <label className="pp-label">Какие артефакты собирать</label>
        <div className="flex gap-4 flex-wrap">
          {[
            ['images', 'Изображения (ChatGPT)'],
            ['video', 'Видео (kling.ai)'],
            ['ozon', 'Excel · Ozon'],
            ['wb', 'Excel · WB'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={form.artifacts[key]} onChange={() => toggleArtifact(key)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {!form.article && <p className="text-xs mb-2" style={{ color: 'var(--clay-dark)' }}>Заполните поле «Артикульная серия» перед отправкой</p>}
      <button className="pp-btn pp-btn-primary" disabled={loading || !form.article || !form.moldName} onClick={() => onSubmit(buildQuestionnaire())}>
        <Plus size={14} aria-hidden="true" /> {loading ? 'Запускаем…' : 'Сохранить и запустить пайплайн'}
      </button>
    </div>
  );
}

// Maps step key (used in frontend) to step id (used in API)
const STEP_KEY_TO_ID = {
  normalize: '01-normalize',
  texts:     '02-texts',
  images:    '03-images',
  video:     '04-video',
  excel:     '05-excel',
  assemble:  '06-assemble',
};

// Transform manifest.steps into the VERSIONS shape expected by VersionPicker
function manifestToVersions(manifest) {
  if (!manifest?.steps) return {};
  const result = {};
  for (const [stepId, meta] of Object.entries(manifest.steps)) {
    const key = Object.entries(STEP_KEY_TO_ID).find(([, id]) => id === stepId)?.[0];
    if (!key) continue;
    result[key] = (meta.history || []).map((h, i) => ({
      v:    h.version,
      note: h.note || (h.needsReview ? '⚠ требует проверки' : `версия ${h.version}`),
      date: h.createdAt ? new Date(h.createdAt).toLocaleDateString('ru', { day: '2-digit', month: 'short' }) : `v${i + 1}`,
    }));
  }
  return result;
}

export default function PipelineApp() {
  const [lines, setLines]           = useState([]);
  const [activeLineId, setActiveLineId] = useState(null);
  const [activeTab, setActiveTab]   = useState('results');
  const [activeStep, setActiveStep] = useState('normalize');
  const [versionState, setVersionState] = useState({});
  const [manifests, setManifests]   = useState({});
  const [formLoading, setFormLoading] = useState(false);
  const [toast, setToast]           = useState(null);

  // Fetch lines list on mount
  useEffect(() => {
    apiFetch('/lines')
      .then(data => {
        const apiLines = (data.lines || []).map(l => ({ ...l, id: l.article, name: l.moldName || l.article, theme: '', color: '', status: 'active', sizes: l.sizes || ALL_SIZES }));
        setLines(apiLines);
        setActiveLineId(apiLines[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  // Fetch manifest whenever active line changes
  const refreshManifest = useCallback((lineId) => {
    apiFetch(`/lines/${lineId}/manifest`)
      .then(manifest => setManifests(m => ({ ...m, [lineId]: manifest })))
      .catch(() => { /* keep VERSIONS mock */ });
  }, []);

  useEffect(() => { if (activeLineId) refreshManifest(activeLineId); }, [activeLineId, refreshManifest]);

  const line         = lines.find((l) => l.id === activeLineId) ?? lines[0] ?? null;
  const versions     = manifests[activeLineId] ? manifestToVersions(manifests[activeLineId]) : {};
  const stepVersions = versions[activeStep] || [];
  const currentVersion = versionState[`${activeLineId}.${activeStep}`] ?? stepVersions[stepVersions.length - 1]?.v;

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const handleRegenerateStep = async () => {
    const stepId = STEP_KEY_TO_ID[activeStep];
    showToast(`Шаг «${STEPS.find((s) => s.key === activeStep).label}» перезапускается…`);
    try {
      await apiFetch(`/lines/${activeLineId}/steps/${stepId}/regenerate`, { method: 'POST', body: JSON.stringify({ force: true }) });
      showToast('Перегенерация запущена — обновится автоматически');
      setTimeout(() => refreshManifest(activeLineId), 3000);
    } catch (err) {
      showToast(`Ошибка: ${err.message}`);
    }
  };

  const handleRegenerateItem = async (lineId, size, type) => {
    const stepId = STEP_KEY_TO_ID[activeStep];
    const item   = type ? `${size}_${type}` : size;
    showToast(`Перегенерация: ${size}${type ? ` · ${type}` : ''} — задача отправлена`);
    try {
      await apiFetch(`/lines/${lineId}/steps/${stepId}/items/${item}/regenerate`, { method: 'POST', body: JSON.stringify({ force: true }) });
    } catch (err) {
      showToast(`Ошибка: ${err.message}`);
    }
  };

  const handleFormSubmit = async (questionnaire) => {
    setFormLoading(true);
    try {
      const res = await apiFetch('/lines', { method: 'POST', body: JSON.stringify(questionnaire) });
      showToast('Опросник сохранён, пайплайн запущен');
      // Add new line to sidebar if not already there
      if (!lines.find(l => l.id === questionnaire.article)) {
        setLines(prev => [...prev, {
          id: questionnaire.article,
          name: questionnaire.moldName,
          theme: questionnaire.theme,
          color: questionnaire.color,
          status: 'active',
          sizes: questionnaire.sizes.map(s => s.size),
        }]);
      }
      setActiveLineId(questionnaire.article);
      setActiveTab('results');
      refreshManifest(questionnaire.article);
    } catch (err) {
      showToast(`Ошибка запуска пайплайна: ${err.message}`);
    } finally {
      setFormLoading(false);
    }
  };

  const renderStep = () => {
    switch (activeStep) {
      case 'normalize': return <NormalizeView line={line} manifest={manifests[activeLineId]} />;
      case 'texts': return <TextsView line={line} manifest={manifests[activeLineId]} />;
      case 'images': return <ImagesView line={line} manifest={manifests[activeLineId]} onRegenItem={handleRegenerateItem} />;
      case 'video': return <VideoView line={line} onRegenItem={handleRegenerateItem} />;
      case 'excel': return <ExcelView line={line} />;
      case 'assemble': return <AssembleView line={line} />;
      default: return null;
    }
  };

  return (
    <div className="pp-root" style={{ minHeight: 600 }}>
      <style>{STYLES}</style>
      <div className="flex" style={{ minHeight: 600 }}>

        <aside className="pp-line border-r p-4" style={{ width: 220, flexShrink: 0 }}>
          <div className="pp-display text-sm mb-4 pp-muted" style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>Линейки молдов</div>
          <div className="flex flex-col gap-1">
            {lines.map((l) => (
              <button
                key={l.id}
                onClick={() => { setActiveLineId(l.id); setActiveTab('results'); setActiveStep('normalize'); }}
                className="rounded-lg p-2 text-left"
                style={{ background: l.id === activeLineId ? 'var(--lavender-soft)' : 'transparent', border: '1px solid transparent', borderColor: l.id === activeLineId ? 'var(--lavender)' : 'transparent' }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{l.name}</span>
                  <span className="pp-mono text-xs pp-muted">{l.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <SizeLadder sizes={l.sizes} />
                  <StatusBadge status={l.status} />
                </div>
              </button>
            ))}
          </div>
          <button className="pp-btn mt-3 w-full" onClick={() => { setActiveTab('form'); }} style={{ justifyContent: 'center' }}>
            <Plus size={14} aria-hidden="true" /> Новая линейка
          </button>
        </aside>

        <main className="flex-1 p-5">
          {toast && (
            <div className="rounded-lg p-3 mb-4 flex items-center justify-between" style={{ background: 'var(--sage-soft)', color: 'var(--sage-dark)' }}>
              <span className="text-sm">{toast}</span>
              <button className="pp-btn-ghost" onClick={() => setToast(null)} aria-label="Закрыть уведомление"><X size={14} aria-hidden="true" /></button>
            </div>
          )}

          {!line ? (
            <div className="flex flex-col items-center justify-center" style={{ minHeight: 300, gap: 12 }}>
              <p className="pp-display text-xl pp-muted" style={{ fontWeight: 400 }}>Нет линеек</p>
              <p className="text-sm pp-muted">Создайте первую линейку молда</p>
              <button className="pp-btn pp-btn-primary" onClick={() => setActiveTab('form')}>
                <Plus size={14} aria-hidden="true" /> Новая линейка
              </button>
            </div>
          ) : (<>

          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="pp-display text-2xl" style={{ fontWeight: 500 }}>{line.name}</h1>
                <span className="pp-mono text-sm pp-muted">{line.id}</span>
                <SizeLadder sizes={line.sizes} dim={5} />
              </div>
              <p className="text-sm pp-muted mt-1">{line.theme} · {line.color}</p>
            </div>
            <div className="flex gap-1 pp-line border rounded-lg p-1">
              <button
                onClick={() => setActiveTab('results')}
                className="text-sm px-3 py-1.5 rounded-md"
                style={{ background: activeTab === 'results' ? 'var(--lavender)' : 'transparent', color: activeTab === 'results' ? '#fff' : 'var(--ink)' }}
              >
                Результаты
              </button>
              <button
                onClick={() => setActiveTab('form')}
                className="text-sm px-3 py-1.5 rounded-md"
                style={{ background: activeTab === 'form' ? 'var(--lavender)' : 'transparent', color: activeTab === 'form' ? '#fff' : 'var(--ink)' }}
              >
                Опросник
              </button>
            </div>
          </div>

          {activeTab === 'form' ? (
            <QuestionnaireForm onSubmit={handleFormSubmit} loading={formLoading} />
          ) : (
            <>
              <StepperNav active={activeStep} onSelect={setActiveStep} lineId={activeLineId} manifests={manifests} line={line} />
              <div className="my-3">
                <VersionPicker
                  versions={stepVersions}
                  value={currentVersion}
                  onChange={(v) => setVersionState((s) => ({ ...s, [`${activeLineId}.${activeStep}`]: v }))}
                  onRegenerate={handleRegenerateStep}
                />
              </div>
              {renderStep()}
            </>
          )}
          </>)}
        </main>
      </div>
    </div>
  );
}
