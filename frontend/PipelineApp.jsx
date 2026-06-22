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

// Multipart submission — do NOT use apiFetch (it sets Content-Type: application/json which breaks the boundary)
async function submitQuestionnaire(questionnaire, photoFiles) {
  const fd = new FormData();
  fd.append('questionnaire', JSON.stringify(questionnaire));
  for (const file of photoFiles) {
    fd.append('photos', file, file.name);
  }
  // No Content-Type header — browser sets it automatically with the correct boundary
  const res = await fetch(`${API_BASE}/lines`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`POST /lines → ${res.status}`);
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

const STATUS_LABEL = { active: 'В работе', done: 'Готово', draft: 'Черновик' };
const STATUS_CLASS = { active: 'bg-lavender-soft text-lavender-dark', done: 'bg-sage-soft text-sage-dark', draft: 'bg-clay-soft text-clay-dark' };

const IMAGE_TYPES = [
  { key: 'main', label: 'Главное фото' },
  { key: 'infographic', label: 'Инфографика с размерами' },
  { key: 'scale', label: 'Масштаб с игрушкой' },
  { key: 'lifestyle', label: 'Лайфстайл' },
];

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
            <option key={ver.v} value={ver.v}>v{ver.v} · {ver.date} · {ver.sizeCount} разм.</option>
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
        .catch(() => { setRows(null); });
    } else {
      setRows(null);
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
        .catch(() => { setTextsData({}); });
    } else {
      setTextsData({});
    }
  }, [line.id, manifest]);

  const texts = textsData || {};
  const hasTextsStep = Boolean(manifest?.steps?.['02-texts']);
  return (
    <div className="grid grid-cols-1 gap-3">
      {!hasTextsStep && (
        <p className="text-sm pp-muted">Тексты для размера ещё не сгенерированы. Нажмите «Запустить шаг».</p>
      )}
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
  // Step-04 (video) is out of scope for Phase 4 — every size shows the not-run placeholder.
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
      {line.sizes.map((s) => (
        <div key={s} className="pp-card rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="pp-mono text-xs px-2 py-0.5 rounded-md bg-lavender-soft text-lavender-dark">{s}</span>
            <button className="pp-btn-ghost" onClick={() => onRegenItem(line.id, s)} aria-label={`Перегенерировать видео для ${s}`}>
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="rounded-md flex items-center justify-center mb-2" style={{ height: 80, background: 'var(--paper)', border: '1px solid var(--line)' }}>
            <span className="text-xs pp-muted">нет видео</span>
          </div>
          <div className="text-xs pp-muted">Видео: шаг не запущен</div>
        </div>
      ))}
    </div>
  );
}

function ExcelView({ line, manifest }) {
  const excelMeta = manifest?.steps?.['05-excel'];
  if (!excelMeta) {
    return <div className="pp-card rounded-lg p-6 text-center text-sm pp-muted">Выгрузка не сформирована</div>;
  }
  const lastEntry = (excelMeta.history || [])[(excelMeta.history || []).length - 1];
  const date = lastEntry?.createdAt
    ? new Date(lastEntry.createdAt).toLocaleDateString('ru', { day: '2-digit', month: 'short' })
    : null;
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      {['Ozon', 'Wildberries'].map((mp) => (
        <div key={mp} className="pp-card rounded-lg p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium mb-1">{mp}</div>
            <div className="text-xs pp-muted pp-mono">{line.id}_{mp.toLowerCase().slice(0, 4)}.xlsx</div>
            <div className="text-xs pp-muted mt-1">{line.sizes.length} строк{date ? ` · ${date}` : ''}</div>
          </div>
          <button className="pp-btn" aria-label={`Скачать выгрузку для ${mp}`}>
            <Download size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function AssembleView({ line, manifest }) {
  const steps = manifest?.steps || {};
  const idToLabel = Object.fromEntries(STEPS.map(s => [STEP_KEY_TO_ID[s.key], s.label]));
  const rows = Object.entries(steps)
    .filter(([id]) => idToLabel[id])
    .map(([id, meta]) => ({ id, label: idToLabel[id], version: meta.currentVersion }));

  if (rows.length === 0) {
    return <div className="pp-card rounded-lg p-6 text-center text-sm pp-muted">Пакет ещё не собран — запустите шаги выше</div>;
  }
  return (
    <div className="pp-card rounded-lg p-4">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-sm">
            <span>{r.label}</span>
            <span className="pp-mono text-xs pp-muted">{r.version ? `v${r.version}` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Returns { state: 'idle'|'partial'|'review'|'done', label?: string }
function computeStepStatus(stepKey, manifest, lineSizes) {
  const stepId   = STEP_KEY_TO_ID[stepKey];
  const stepMeta = manifest?.steps?.[stepId];
  if (!stepMeta) return { state: 'idle' };
  if (stepMeta.error) return { state: 'error' };   // D-03: error takes priority over partial/done/review

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
  // D-04 / UI-SPEC L132: error → clay ✘ ; running → lavender animated …
  error:   () => <span style={{ fontSize: 10, color: 'var(--clay-dark)', flexShrink: 0 }}>✘</span>,
  running: () => <span style={{ fontSize: 10, color: 'var(--lavender)', flexShrink: 0 }}>…</span>,
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
      {photoFiles.length === 0 && <p className="text-xs mb-2" style={{ color: 'var(--clay-dark)' }}>Прикрепите хотя бы одно фото молда</p>}
      <button className="pp-btn pp-btn-primary" disabled={loading || !form.article || !form.moldName || photoFiles.length === 0} onClick={() => onSubmit(buildQuestionnaire(), photoFiles)}>
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
    const history = meta.history || [];
    // Unique `size` values per version number across that step's history entries
    const sizesByVersion = {};
    for (const h of history) {
      if (!h.size) continue;
      (sizesByVersion[h.version] ||= new Set()).add(h.size);
    }
    result[key] = history.map((h, i) => ({
      v:    h.version,
      note: h.note || (h.needsReview ? '⚠ требует проверки' : `версия ${h.version}`),
      date: h.createdAt ? new Date(h.createdAt).toLocaleDateString('ru', { day: '2-digit', month: 'short' }) : `v${i + 1}`,
      sizeCount: sizesByVersion[h.version]?.size ?? 0,
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
  const [listError, setListError]   = useState(null);
  const [listLoading, setListLoading] = useState(true);

  // Fetch lines list on mount
  useEffect(() => {
    apiFetch('/lines')
      .then(data => {
        const apiLines = (data.lines || []).map(l => ({ ...l, id: l.article, name: l.moldName || l.article, theme: '', color: '', status: 'active', sizes: l.sizes || ALL_SIZES }));
        setLines(apiLines);
        setActiveLineId(apiLines[0]?.id ?? null);
        setListLoading(false);
      })
      .catch(() => {
        setListError('Не удалось загрузить линейки. Проверьте, что сервер запущен, и обновите страницу.');
        setListLoading(false);
      });
  }, []);

  // Fetch manifest whenever active line changes
  const refreshManifest = useCallback((lineId) => {
    apiFetch(`/lines/${lineId}/manifest`)
      .then(manifest => setManifests(m => ({ ...m, [lineId]: manifest })))
      .catch(() => {});
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

  const handleFormSubmit = async (questionnaire, photoFiles) => {
    setFormLoading(true);
    try {
      const res = await submitQuestionnaire(questionnaire, photoFiles);
      showToast('Опросник сохранён, пайплайн запущен');
      // Append the newly-created line to the sidebar without a page reload (UI-02 / D-10).
      // Use the same id/name/sizes mapping shape as the mount effect so the new row matches.
      const newLine = res.questionnaire || questionnaire;
      const newId   = newLine.article;
      const newSizes = Array.isArray(newLine.sizes)
        ? newLine.sizes.map(s => (typeof s === 'string' ? s : s.size))
        : ALL_SIZES;
      if (!lines.find(l => l.id === newId)) {
        setLines(prev => [...prev, {
          id: newId,
          name: newLine.moldName || newId,
          theme: '',
          color: '',
          status: 'active',
          sizes: newSizes,
        }]);
      }
      setActiveLineId(newId);
      setActiveTab('results');
      refreshManifest(newId);
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
      case 'excel': return <ExcelView line={line} manifest={manifests[activeLineId]} />;
      case 'assemble': return <AssembleView line={line} manifest={manifests[activeLineId]} />;
      default: return null;
    }
  };

  return (
    <div className="pp-root" style={{ minHeight: 600 }}>
      <style>{STYLES}</style>
      <div className="flex" style={{ minHeight: 600 }}>

        <aside className="pp-line border-r p-4" style={{ width: 220, flexShrink: 0 }}>
          <div className="pp-display text-sm mb-4 pp-muted" style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>Линейки молдов</div>
          {listError && (
            <p className="text-sm mb-3" style={{ color: 'var(--clay-dark)', lineHeight: 1.5 }}>{listError}</p>
          )}
          <div className="flex flex-col gap-1">
            {listLoading ? (
              [0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{ height: 44, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)' }}
                />
              ))
            ) : (
              lines.map((l) => (
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
              ))
            )}
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

          {activeTab === 'form' && !line ? (
            <QuestionnaireForm onSubmit={handleFormSubmit} loading={formLoading} />
          ) : !listLoading && !listError && lines.length === 0 ? (
            <div className="flex flex-col items-center justify-center" style={{ minHeight: 300, gap: 12 }}>
              <p className="pp-display text-xl pp-muted" style={{ fontWeight: 400 }}>Линеек пока нет.</p>
              <button className="pp-btn pp-btn-primary" onClick={() => setActiveTab('form')}>
                <Plus size={14} aria-hidden="true" /> Создайте первую →
              </button>
            </div>
          ) : !line ? null : (<>

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
              {(() => {
                const activeStatus = computeStepStatus(activeStep, manifests[activeLineId], line?.sizes);
                if (activeStatus.state !== 'error') return null;
                const errMsg = manifests[activeLineId]?.steps?.[STEP_KEY_TO_ID[activeStep]]?.error;
                return (
                  <div
                    className="pp-card rounded-lg p-4 mb-3"
                    style={{ borderColor: 'var(--clay)', background: 'var(--clay-soft)' }}
                  >
                    <p className="text-sm mb-3" style={{ color: 'var(--clay-dark)', lineHeight: 1.5 }}>
                      Ошибка шага: {errMsg}
                    </p>
                    <button className="pp-btn pp-btn-primary" onClick={handleRegenerateStep}>
                      <RotateCcw size={14} aria-hidden="true" /> Повторить шаг
                    </button>
                  </div>
                );
              })()}
              {renderStep()}
            </>
          )}
          </>)}
        </main>
      </div>
    </div>
  );
}
