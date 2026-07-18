import { useState, useEffect, useCallback } from 'react';
import {
  Layers, Type, Image as ImageIcon, Film, FileSpreadsheet, Folder,
  ChevronDown, RotateCcw, Plus, Upload, Check, Play, Download, X,
  Trash2, Loader2, Paperclip, Edit3, Globe, Save, Pencil,
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
async function submitQuestionnaire(questionnaire, photoFiles, photoTypes) {
  const fd = new FormData();
  fd.append('questionnaire', JSON.stringify(questionnaire));
  if (photoTypes && Object.keys(photoTypes).length > 0) {
    fd.append('photoTypes', JSON.stringify(photoTypes));
  }
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
@keyframes pp-spin { to { transform: rotate(360deg); } }
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

const VIDEO_TYPES = [
  { key: 'turntable', label: '360° вращение' },
  { key: 'detail',    label: 'Детали' },
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

function NormalizeView({ line, manifest, showToast }) {
  const [rows, setRows]         = useState(null);
  const [rawData, setRawData]   = useState(null); // full masterData array for editing
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState(null); // { label → { size → value } }
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    const stepMeta = manifest?.steps?.['01-normalize'];
    if (stepMeta) {
      apiFetch(`/lines/${line.id}/steps/01-normalize`)
        .then(res => {
          const arr = res.data?.['master-data.json'];
          if (Array.isArray(arr)) { setRawData(arr); setRows(apiArrayToRows(arr)); }
        })
        .catch(() => { setRows(null); setRawData(null); });
    } else {
      setRows(null); setRawData(null);
    }
  }, [line.id, manifest]);

  const startEdit = () => {
    if (!rows) return;
    const copy = {};
    for (const row of rows) copy[row.label] = { ...row.values };
    setEditData(copy);
    setEditMode(true);
  };

  const cancelEdit = () => { setEditMode(false); setEditData(null); };

  const saveEdit = async () => {
    if (!rawData || !editData) return;
    setSaving(true);
    try {
      // Merge edited numeric fields back into rawData array
      const updatedMaster = rawData.map(sizeRow => {
        const patched = { ...sizeRow };
        for (const row of rows) {
          const key = Object.entries(sizeRow).find(([k, v]) => row.label === NORMALIZE_FIELDS.find(f => f.key === k)?.label)?.[0];
          if (key && editData[row.label]?.[sizeRow.size] !== undefined) {
            patched[key] = Number(editData[row.label][sizeRow.size]) || 0;
          }
        }
        return patched;
      });
      await apiFetch(`/lines/${line.id}/master-data`, { method: 'PUT', body: JSON.stringify({ masterData: updatedMaster }) });
      setRawData(updatedMaster);
      setRows(apiArrayToRows(updatedMaster));
      setEditMode(false);
      setEditData(null);
      showToast?.('Мастер-данные сохранены');
    } catch (err) {
      showToast?.(`Ошибка сохранения: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!rows) {
    return <p className="text-sm pp-muted p-4">Мастер-данные ещё не созданы. Нажмите «Запустить шаг».</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-end mb-2 gap-2">
        {editMode ? (<>
          <button className="pp-btn" onClick={cancelEdit}><X size={13} /> Отменить</button>
          <button className="pp-btn pp-btn-primary" onClick={saveEdit} disabled={saving}>
            <Save size={13} /> {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>) : (
          <button className="pp-btn" onClick={startEdit}><Pencil size={13} /> Редактировать</button>
        )}
      </div>
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
            {rows.map((row) => (
              <tr key={row.label} style={{ borderTop: '1px solid var(--line)' }}>
                <td className="p-3 pp-muted">{row.label}</td>
                {ALL_SIZES.map((s) => (
                  <td
                    key={s}
                    className="p-1 text-right"
                    style={{ background: s === 'M' && line.sizes.includes(s) ? 'var(--lavender-soft)' : 'transparent' }}
                  >
                    {editMode && editData ? (
                      <input
                        type="number" step="0.01"
                        className="pp-input pp-mono text-right"
                        style={{ padding: '3px 5px', fontSize: 12, width: 70 }}
                        value={editData[row.label]?.[s] ?? ''}
                        onChange={e => setEditData(prev => ({
                          ...prev,
                          [row.label]: { ...prev[row.label], [s]: e.target.value },
                        }))}
                      />
                    ) : (
                      <span className="pp-mono" style={{ padding: '0 8px', display: 'inline-block' }}>
                        {row.values[s] !== undefined ? row.values[s] : '—'}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TextsView({ line, manifest }) {
  const [textsData, setTextsData] = useState({});
  const [marketplace, setMarketplace] = useState('ozon');

  useEffect(() => {
    const stepMeta = manifest?.steps?.['02-texts'];
    if (!stepMeta) { setTextsData({}); return; }
    apiFetch(`/lines/${line.id}/steps/02-texts`)
      .then(res => {
        const all = {};
        for (const [name, payload] of Object.entries(res.data || {})) {
          // name: {size}_texts_{marketplace}.json  OR  {size}_texts.json (legacy)
          const mpMatch = name.match(/^([A-Z]+)_texts_(ozon|wb)\.json$/);
          const legMatch = name.match(/^([A-Z]+)_texts\.json$/);
          if (mpMatch) {
            const [, size, mp] = mpMatch;
            (all[mp] ||= {})[size] = payload.texts || payload;
          } else if (legMatch) {
            const [, size] = legMatch;
            // Store under both marketplaces as fallback
            const t = payload.texts || payload;
            (all.ozon ||= {})[size] ||= t;
            (all.wb   ||= {})[size] ||= t;
          }
        }
        setTextsData(all);
      })
      .catch(() => setTextsData({}));
  }, [line.id, manifest]);

  const texts = textsData[marketplace] || {};
  const hasTextsStep = Boolean(manifest?.steps?.['02-texts']);
  const hasMarketplace = Boolean(textsData.ozon || textsData.wb);

  return (
    <div className="grid grid-cols-1 gap-3">
      {hasMarketplace && (
        <div className="flex gap-1 pp-line border rounded-lg p-1" style={{ width: 'fit-content' }}>
          {[['ozon', 'Ozon'], ['wb', 'WB']].map(([mp, label]) => (
            <button key={mp} onClick={() => setMarketplace(mp)}
              className="text-sm px-3 py-1 rounded-md"
              style={{ background: marketplace === mp ? 'var(--lavender)' : 'transparent', color: marketplace === mp ? '#fff' : 'var(--ink)' }}>
              {label}
            </button>
          ))}
        </div>
      )}
      {!hasTextsStep && <p className="text-sm pp-muted">Тексты ещё не сгенерированы. Нажмите «Запустить шаг».</p>}
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

function ImagesView({ line, manifest, showToast, onImagesRunning }) {
  // --- Slide editor state (999.1-03) ---
  const [slides, setSlides]                 = useState(null);
  const [feedbackSuffix, setFeedbackSuffix] = useState('');
  const [promptBusy, setPromptBusy]         = useState({});   // slideId → bool (generate-prompt in flight)
  const [promptError, setPromptError]       = useState({});   // slideId → error copy
  const [descError, setDescError]           = useState({});   // slideId → bool (empty-description attempt)
  const [genBusy, setGenBusy]               = useState({});   // slideId → bool (image regenerate request in flight)
  const [confirmRemove, setConfirmRemove]   = useState(null); // slideId pending confirm
  const [saving, setSaving]                 = useState(false);

  // Load the per-line slide config (seeded defaults on first open). D-01/D-03.
  useEffect(() => {
    let cancelled = false;
    setSlides(null);
    apiFetch(`/lines/${line.id}/slides`)
      .then((cfg) => {
        if (cancelled) return;
        setSlides(Array.isArray(cfg.slides) ? cfg.slides : []);
        setFeedbackSuffix(typeof cfg.feedbackSuffix === 'string' ? cfg.feedbackSuffix : '');
      })
      .catch(() => { if (!cancelled) setSlides([]); });
    return () => { cancelled = true; };
  }, [line.id]);

  const updateSlide = (id, patch) => setSlides((prev) => (prev || []).map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const genPrompt = async (slide) => {
    if (!slide.description || !slide.description.trim()) {
      setDescError((e) => ({ ...e, [slide.id]: true }));
      return;
    }
    setDescError((e) => ({ ...e, [slide.id]: false }));
    setPromptError((e) => ({ ...e, [slide.id]: '' }));
    setPromptBusy((b) => ({ ...b, [slide.id]: true }));
    try {
      const res = await apiFetch(`/lines/${line.id}/slides/${slide.id}/generate-prompt`, {
        method: 'POST', body: JSON.stringify({ description: slide.description }),
      });
      updateSlide(slide.id, { generatedPrompt: res.generatedPrompt });
    } catch {
      setPromptError((e) => ({ ...e, [slide.id]: 'Не удалось сгенерировать промпт. Проверьте описание и попробуйте снова.' }));
    } finally {
      setPromptBusy((b) => ({ ...b, [slide.id]: false }));
    }
  };

  const addSlide = () => setSlides((prev) => ([...(prev || []), {
    id: 'custom-' + crypto.randomUUID(),
    label: 'Новый слайд', description: '', generatedPrompt: '', files: [], default: false,
  }]));

  const removeSlide = (id) => { setSlides((prev) => (prev || []).filter((s) => s.id !== id)); setConfirmRemove(null); };

  // Persist the whole config (used by Save and before any generation so step-images reads current prompts).
  const persistConfig = () => apiFetch(`/lines/${line.id}/slides`, { method: 'POST', body: JSON.stringify({ feedbackSuffix, slides }) });

  const saveConfig = async () => {
    setSaving(true);
    try {
      await persistConfig();
      showToast('Конфигурация слайдов сохранена');
    } catch (err) {
      showToast(`Ошибка: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Multipart upload — do NOT use apiFetch (it forces application/json and breaks the boundary).
  const handleAttach = async (slideId, fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    try {
      const res = await fetch(`${API_BASE}/lines/${line.id}/slides/${slideId}/files`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`POST /slides/${slideId}/files → ${res.status}`);
      const data = await res.json();
      const refs = Array.isArray(data.refs) ? data.refs : [];
      setSlides((prev) => (prev || []).map((s) => (s.id === slideId ? { ...s, files: [...(s.files || []), ...refs] } : s)));
    } catch (err) {
      showToast(`Ошибка загрузки: ${err.message}`);
    }
  };

  const removeFile = (slideId, ref) => setSlides((prev) => (prev || []).map((s) => (s.id === slideId ? { ...s, files: (s.files || []).filter((f) => f !== ref) } : s)));

  const regenerateSlide = async (slide) => {
    setGenBusy((b) => ({ ...b, [slide.id]: true }));
    try {
      await persistConfig(); // ensure step-images reads the current prompt/files
      await apiFetch(`/lines/${line.id}/slides/${slide.id}/regenerate`, { method: 'POST', body: JSON.stringify({ force: true }) });
      onImagesRunning();     // optimistic running on the existing 5s poll
      showToast(`Генерация запущена: ${slide.label}`);
    } catch (err) {
      showToast(`Ошибка: ${err.message}`);
    } finally {
      setGenBusy((b) => ({ ...b, [slide.id]: false }));
    }
  };

  const generateAll = async () => {
    const list = slides || [];
    if (list.length === 0) return;
    try {
      await persistConfig();
      for (const s of list) {
        await apiFetch(`/lines/${line.id}/slides/${s.id}/regenerate`, { method: 'POST', body: JSON.stringify({ force: true }) });
      }
      onImagesRunning();
      showToast('Генерация всех слайдов запущена');
    } catch (err) {
      showToast(`Ошибка: ${err.message}`);
    }
  };

  // --- Slide-driven result grid (Plan 02 naming: {size}_{slideId}.png) ---
  const imgMeta = manifest?.steps?.['03-images'];
  const history = imgMeta?.history || [];

  // Build map keyed on {size}_{slideKey} so both custom and default slides display.
  const done = {};
  for (const h of history) {
    const slideKey = h.slideId || h.imageType;
    const key = `${h.size}_${slideKey}`;
    if (!done[key] || h.version > done[key].version) done[key] = h;
  }

  const imgUrl = (size, slideId) => {
    const h = done[`${size}_${slideId}`];
    if (!h) return null;
    return `${API_BASE}/lines/${line.id}/steps/03-images/artifacts/${size}_${slideId}.png?version=${h.version}`;
  };

  return (
    <div className="flex flex-col" style={{ gap: 24 }}>
      {/* Слайды карточки — per-line slide editor (D-01) */}
      <section>
        <div className="mb-1" style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>Слайды карточки</div>
        <p className="pp-muted mb-4" style={{ fontSize: 12, fontWeight: 400, lineHeight: 1.5 }}>
          Опишите каждый слайд — AI составит промпт, при необходимости отредактируйте его вручную.
        </p>

        {slides === null ? (
          <div className="pp-card rounded-lg p-4">
            <div style={{ fontSize: 14, fontWeight: 500 }}>Загрузка слайдов…</div>
            <p className="pp-muted" style={{ fontSize: 12, fontWeight: 400 }}>Подтягиваем набор слайдов по умолчанию.</p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 12 }}>
            {slides.map((slide) => {
              const hasPrompt = Boolean(slide.generatedPrompt && slide.generatedPrompt.trim());
              const descEmpty = !slide.description || !slide.description.trim();
              return (
                <div key={slide.id} className="pp-card rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3" style={{ gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3 }}>{slide.label}</span>
                    {!slide.default && (
                      confirmRemove === slide.id ? (
                        <span className="flex items-center gap-2 flex-wrap" style={{ fontSize: 12, fontWeight: 400 }}>
                          <span style={{ color: 'var(--clay-dark)' }}>Удалить «{slide.label}»? Действие нельзя отменить.</span>
                          <button className="pp-btn" style={{ padding: '4px 10px', color: 'var(--clay-dark)' }} onClick={() => removeSlide(slide.id)}>Удалить</button>
                          <button className="pp-btn" style={{ padding: '4px 10px' }} onClick={() => setConfirmRemove(null)}>Отмена</button>
                        </span>
                      ) : (
                        <button className="pp-btn-ghost" aria-label="Удалить слайд" onClick={() => setConfirmRemove(slide.id)}>
                          <Trash2 size={14} aria-hidden="true" style={{ color: 'var(--clay-dark)' }} />
                        </button>
                      )
                    )}
                  </div>

                  <label className="pp-label">Описание слайда</label>
                  <textarea
                    className="pp-textarea"
                    rows={3}
                    placeholder="Что должно быть на слайде (например: инфографика с размерами молда на фоне шаблона)"
                    value={slide.description || ''}
                    onChange={(e) => { updateSlide(slide.id, { description: e.target.value }); if (e.target.value.trim()) setDescError((x) => ({ ...x, [slide.id]: false })); }}
                  />

                  <div className="flex items-center gap-3 mt-2 mb-3 flex-wrap">
                    <button className="pp-btn" disabled={descEmpty || promptBusy[slide.id]} onClick={() => genPrompt(slide)}>
                      {promptBusy[slide.id]
                        ? <><Loader2 size={14} aria-hidden="true" style={{ animation: 'pp-spin 1s linear infinite' }} /> Генерирую промпт…</>
                        : 'Сгенерировать промпт'}
                    </button>
                    {descError[slide.id] && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--clay-dark)' }}>Заполните описание перед генерацией промпта.</span>}
                    {promptError[slide.id] && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--clay-dark)' }}>{promptError[slide.id]}</span>}
                  </div>

                  <label className="pp-label">Промпт для генерации (можно править)</label>
                  <textarea
                    className="pp-textarea pp-mono"
                    rows={5}
                    readOnly={!hasPrompt}
                    placeholder="Промпт появится здесь после нажатия «Сгенерировать промпт»"
                    value={slide.generatedPrompt || ''}
                    onChange={(e) => updateSlide(slide.id, { generatedPrompt: e.target.value })}
                    style={!hasPrompt ? { color: 'var(--muted)', background: 'var(--paper)' } : undefined}
                  />

                  {/* GAP-01: background image upload */}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <label className="pp-btn pp-btn-ghost" aria-label="Загрузить фон" title="Загрузить фон слайда" style={{ cursor: 'pointer', fontSize: 12 }}>
                      <ImageIcon size={14} aria-hidden="true" /> Фон
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const fd = new FormData();
                        fd.append('files', f, f.name);
                        try {
                          const res = await fetch(`${API_BASE}/lines/${line.id}/slides/${slide.id}/files`, { method: 'POST', body: fd });
                          if (!res.ok) throw new Error(res.status);
                          const data = await res.json();
                          const ref = data.refs?.[0] || data.ref;
                          if (ref) updateSlide(slide.id, { backgroundRef: ref });
                          showToast('Фон загружен');
                        } catch (err) { showToast(`Ошибка загрузки фона: ${err.message}`); }
                        e.target.value = '';
                      }} />
                    </label>
                    {slide.backgroundRef && (
                      <span className="pp-mono text-xs flex items-center gap-1 rounded-md px-2 py-0.5"
                        style={{ background: 'var(--sage-soft)', border: '1px solid var(--sage)', color: 'var(--sage-dark)' }}>
                        {slide.backgroundRef.split('/').pop()}
                        <button className="pp-btn-ghost" style={{ padding: 0 }} onClick={() => updateSlide(slide.id, { backgroundRef: null })}>
                          <X size={12} aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </div>

                  {/* Reference-file attachments (D-09) */}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <label className="pp-btn pp-btn-ghost" aria-label="Прикрепить файлы" title="Прикрепить файлы" style={{ cursor: 'pointer' }}>
                      <Paperclip size={14} aria-hidden="true" />
                      <input type="file" multiple style={{ display: 'none' }} onChange={(e) => { handleAttach(slide.id, e.target.files); e.target.value = ''; }} />
                    </label>
                    <span className="pp-muted" style={{ fontSize: 12, fontWeight: 400 }}>Референсы, шаблоны, фото — необязательно</span>
                  </div>
                  {Array.isArray(slide.files) && slide.files.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {slide.files.map((ref) => (
                        <span key={ref} className="pp-mono text-xs flex items-center gap-1 rounded-md px-2 py-0.5" style={{ background: 'var(--paper)', border: '1px solid var(--line)' }}>
                          {ref.split('/').pop()}
                          <button className="pp-btn-ghost" aria-label={`Убрать файл ${ref.split('/').pop()}`} style={{ padding: 0 }} onClick={() => removeFile(slide.id, ref)}>
                            <X size={12} aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Per-slide image generation (D-08) */}
                  <div className="flex items-center gap-3 mt-3 flex-wrap">
                    <button className="pp-btn pp-btn-primary" disabled={genBusy[slide.id]} onClick={() => regenerateSlide(slide)}>
                      {genBusy[slide.id]
                        ? <><Loader2 size={14} aria-hidden="true" style={{ animation: 'pp-spin 1s linear infinite' }} /> Генерирую…</>
                        : <><ImageIcon size={14} aria-hidden="true" /> Сгенерировать изображение</>}
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="pp-card rounded-lg p-4">
              <label className="pp-label">Общие правки для критика (необязательно)</label>
              <textarea className="pp-textarea" rows={2} value={feedbackSuffix} onChange={(e) => setFeedbackSuffix(e.target.value)} />
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button className="pp-btn" onClick={addSlide}>
                <Plus size={14} aria-hidden="true" /> Добавить слайд
              </button>
              <button className="pp-btn pp-btn-primary" disabled={saving} onClick={saveConfig}>
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
              <button className="pp-btn pp-btn-primary" onClick={generateAll}>
                <ImageIcon size={14} aria-hidden="true" /> Сгенерировать все
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Slide-driven result grid — keyed on {size}_{slideId} so custom slides display */}
      <div className="flex flex-col gap-4">
        {line.sizes.map((s) => (
          <div key={s} className="pp-card rounded-lg p-4">
            <div className="pp-mono text-xs px-2 py-0.5 rounded-md bg-lavender-soft text-lavender-dark inline-block mb-3">{s}</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
              {(slides || []).map((slide) => {
                const url  = imgUrl(s, slide.id);
                const meta = done[`${s}_${slide.id}`];
                return (
                  <div key={slide.id} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                    <div className="relative" style={{ aspectRatio: '1', background: 'var(--paper)' }}>
                      {url
                        ? <img src={url} alt={`${s} ${slide.label}`} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><ImageIcon size={24} className="pp-muted" aria-hidden="true" /></div>
                      }
                      {meta?.needsReview && <span className="absolute top-1 right-1 text-xs bg-yellow-100 text-yellow-800 px-1 rounded">проверить</span>}
                    </div>
                    <div className="p-2 flex items-center justify-between">
                      <span className="text-xs pp-muted">{slide.label}</span>
                      <button className="pp-btn-ghost" onClick={() => regenerateSlide(slide)} aria-label="Перегенерировать изображение">
                        <RotateCcw size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!imgMeta && <p className="text-sm pp-muted">Изображения ещё не генерировались. Нажмите «Сгенерировать изображение».</p>}
      </div>
    </div>
  );
}

function VideoView({ line, manifest, onRegenItem }) {
  const vidMeta = manifest?.steps?.['04-video'];
  const history = vidMeta?.history || [];

  // Build map: { 'M_turntable': { version, needsReview }, ... }
  const done = {};
  for (const h of history) {
    const key = `${h.size}_${h.videoType}`;
    if (!done[key] || h.version > done[key].version) done[key] = h;
  }

  const videoUrl = (size, videoType) => {
    const h = done[`${size}_${videoType}`];
    if (!h) return null;
    return `${API_BASE}/lines/${line.id}/steps/04-video/artifacts/${size}_${videoType}.mp4?version=${h.version}`;
  };

  return (
    <div className="flex flex-col gap-4">
      {line.sizes.map((s) => (
        <div key={s} className="pp-card rounded-lg p-4">
          <div className="pp-mono text-xs px-2 py-0.5 rounded-md bg-lavender-soft text-lavender-dark inline-block mb-3">{s}</div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {VIDEO_TYPES.map((type) => {
              const url  = videoUrl(s, type.key);
              const meta = done[`${s}_${type.key}`];
              return (
                <div key={type.key} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--line)' }}>
                  <div className="relative" style={{ background: 'var(--paper)' }}>
                    {url
                      ? <video src={url} controls className="w-full" style={{ maxHeight: 160 }} />
                      : <div className="flex items-center justify-center" style={{ height: 80 }}><Film size={24} className="pp-muted" aria-hidden="true" /></div>
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
      {!vidMeta && <p className="text-sm pp-muted">Видео ещё не генерировались. Нажмите «Перегенерировать».</p>}
    </div>
  );
}

function ExcelView({ line, manifest, showToast }) {
  const excelMeta = manifest?.steps?.['05-excel'];
  if (!excelMeta) {
    return <div className="pp-card rounded-lg p-6 text-center text-sm pp-muted">Выгрузка не сформирована</div>;
  }
  const lastEntry = (excelMeta.history || [])[(excelMeta.history || []).length - 1];
  const date = lastEntry?.createdAt
    ? new Date(lastEntry.createdAt).toLocaleDateString('ru', { day: '2-digit', month: 'short' })
    : null;

  const publish = async (mp) => {
    try {
      const res = await apiFetch(`/lines/${line.id}/publish/${mp}`, { method: 'POST' });
      showToast?.(res.error || 'Публикация запущена');
    } catch (err) {
      showToast?.(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {[['ozon', 'Ozon'], ['wb', 'Wildberries']].map(([mpKey, mpLabel]) => {
          const fileName = `${line.id}_${mpKey}.xlsx`;
          const artifactUrl = excelMeta?.currentVersion
            ? `${API_BASE}/lines/${line.id}/steps/05-excel/artifacts/${fileName}?version=${excelMeta.currentVersion}`
            : null;
          return (
            <div key={mpKey} className="pp-card rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-medium mb-1">{mpLabel}</div>
                  <div className="text-xs pp-muted pp-mono">{fileName}</div>
                  <div className="text-xs pp-muted mt-1">{line.sizes.length} строк{date ? ` · ${date}` : ''}</div>
                </div>
                {artifactUrl && (
                  <a href={artifactUrl} download={fileName} className="pp-btn" aria-label={`Скачать ${mpLabel}`}>
                    <Download size={14} aria-hidden="true" />
                  </a>
                )}
              </div>
              <button className="pp-btn w-full" style={{ justifyContent: 'center' }} onClick={() => publish(mpKey)}>
                <Globe size={13} aria-hidden="true" /> Опубликовать на {mpLabel}
              </button>
            </div>
          );
        })}
      </div>
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

function StepperNav({ active, onSelect, lineId, manifests, line, runningSteps }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const Icon      = step.icon;
        const isActive  = step.key === active;
        const manifest  = manifests?.[lineId];
        const status    = computeStepStatus(step.key, manifest, line?.sizes);
        // Optimistic running (D-02): override idle/partial with running while the flag is set
        // (polling clears it once the manifest reaches done/error/review).
        if (runningSteps?.[`${lineId}.${step.key}`] && (status.state === 'idle' || status.state === 'partial')) {
          status.state = 'running';
          status.label = undefined;
        }
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

const PHOTO_TYPES = [
  { value: 'mold',      label: 'Молд',     slide: 'main' },
  { value: 'casting',   label: 'Отливка',  slide: 'infographic' },
  { value: 'lifestyle', label: 'Лайфстайл', slide: 'lifestyle' },
];

function QuestionnaireForm({ onSubmit, loading, initialData, isEdit }) {
  const initForm = (d) => ({
    moldName:   d?.moldName   ?? '',
    article:    d?.article    ?? '',
    brand:      d?.brand      ?? 'ТопМолд',
    theme:      d?.theme      ?? '',
    color:      d?.color      ?? '',
    priceBaseM: d?.priceBaseM ?? 1000,
    moldType:   d?.moldType   ?? 'face',
    sizes: d?.sizes
      ? ALL_SIZES.map(size => {
          const row = (d.sizes || []).find(r => (typeof r === 'string' ? r : r.size) === size);
          return typeof row === 'object' && row ? { ...SIZE_DEFAULTS[size], ...row, size } : { size, ...SIZE_DEFAULTS[size] };
        })
      : ALL_SIZES.map(size => ({ size, ...SIZE_DEFAULTS[size] })),
    artifacts: {
      images: Array.isArray(d?.artifacts) ? d.artifacts.includes('images') : true,
      video:  Array.isArray(d?.artifacts) ? d.artifacts.includes('video')  : true,
      ozon:   Array.isArray(d?.artifacts) ? d.artifacts.includes('excel-ozon') : true,
      wb:     Array.isArray(d?.artifacts) ? d.artifacts.includes('excel-wb')   : true,
    },
  });

  const [form, setForm]             = useState(() => initForm(initialData));
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoTypes, setPhotoTypes] = useState({}); // { filename → 'mold'|'casting'|'lifestyle' }
  const [userTexts, setUserTexts]   = useState({    // GAP-02: optional manual texts
    titleShort: initialData?.userTexts?.titleShort ?? '',
    titleFull:  initialData?.userTexts?.titleFull  ?? '',
    annotation: initialData?.userTexts?.annotation ?? '',
  });
  const [showUserTexts, setShowUserTexts] = useState(Boolean(
    initialData?.userTexts?.titleShort || initialData?.userTexts?.titleFull || initialData?.userTexts?.annotation
  ));
  const [submitted, setSubmitted] = useState(false);

  // Re-initialize when initialData changes (e.g., user switches between lines)
  useEffect(() => {
    setForm(initForm(initialData));
    setUserTexts({
      titleShort: initialData?.userTexts?.titleShort ?? '',
      titleFull:  initialData?.userTexts?.titleFull  ?? '',
      annotation: initialData?.userTexts?.annotation ?? '',
    });
    setShowUserTexts(Boolean(
      initialData?.userTexts?.titleShort || initialData?.userTexts?.titleFull || initialData?.userTexts?.annotation
    ));
    setPhotoFiles([]);
    setPhotoTypes({});
    setSubmitted(false);
  }, [initialData?.article]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleArtifact = (key) => setForm((f) => ({ ...f, artifacts: { ...f.artifacts, [key]: !f.artifacts[key] } }));
  const setSize = (size, field, value) => setForm((f) => ({
    ...f,
    sizes: f.sizes.map(r => r.size === size ? { ...r, [field]: parseFloat(value) || 0 } : r),
  }));

  const onFilesChange = (e) => {
    const files = Array.from(e.target.files || []);
    setPhotoFiles(files);
    // Default all new files to 'mold' type
    setPhotoTypes(prev => {
      const next = { ...prev };
      for (const f of files) if (!next[f.name]) next[f.name] = 'mold';
      return next;
    });
  };

  const buildQuestionnaire = () => {
    const ut = showUserTexts ? { ...userTexts } : {};
    // Strip empty fields so step-texts only skips if ALL three are filled
    Object.keys(ut).forEach(k => { if (!ut[k]) delete ut[k]; });
    return {
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
      ...(Object.keys(ut).length > 0 ? { userTexts: ut } : {}),
    };
  };

  const moldNameError = submitted && !form.moldName;
  const articleError  = !isEdit && submitted && !form.article;
  const photoError    = !isEdit && submitted && photoFiles.length === 0;

  return (
    <div className="pp-card rounded-lg p-5 max-w-3xl">
      <h2 className="pp-display text-lg mb-1" style={{ fontWeight: 500 }}>
        {isEdit ? 'Редактировать опросник' : 'Новая линейка молда'}
      </h2>
      <p className="text-sm pp-muted mb-4">
        {isEdit
          ? 'Внесите изменения — нормализация перезапустится, история версий сохранится.'
          : 'Заполните поля — пайплайн посчитает цены и тексты, физические параметры задайте вручную.'}
      </p>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="pp-label">Имя молда <span aria-hidden="true" style={{ color: 'var(--clay-dark)' }}>*</span></label>
          <input className="pp-input" placeholder="напр. Василиса" value={form.moldName} onChange={(e) => set('moldName', e.target.value)} />
          {moldNameError && <p className="text-xs mt-1" style={{ color: 'var(--clay-dark)' }}>Введите имя молда</p>}
        </div>
        <div>
          <label className="pp-label">Артикульная серия{!isEdit && <span aria-hidden="true" style={{ color: 'var(--clay-dark)' }}> *</span>}</label>
          <input className="pp-input pp-mono" placeholder="напр. 0553" value={form.article}
            readOnly={isEdit}
            style={isEdit ? { background: 'var(--paper)', color: 'var(--muted)' } : undefined}
            onChange={(e) => !isEdit && set('article', e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))} />
          {articleError && <p className="text-xs mt-1" style={{ color: 'var(--clay-dark)' }}>Введите артикул — лат. буквы, цифры, «-» и «_»</p>}
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
                        type="number" step="0.01"
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

      {/* GAP-02: optional user-supplied texts */}
      <div className="mb-4">
        <label className="flex items-center gap-2 text-sm mb-2" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={showUserTexts} onChange={e => setShowUserTexts(e.target.checked)} />
          Задать тексты вручную (иначе AI сгенерирует)
        </label>
        {showUserTexts && (
          <div className="flex flex-col gap-2 pp-card rounded-lg p-3" style={{ background: 'var(--lavender-soft)' }}>
            <div>
              <label className="pp-label">Короткий заголовок (≤ 30 симв.)</label>
              <input className="pp-input" maxLength={30} value={userTexts.titleShort}
                onChange={e => setUserTexts(t => ({ ...t, titleShort: e.target.value }))} />
            </div>
            <div>
              <label className="pp-label">Полный заголовок (≤ 200 симв.)</label>
              <input className="pp-input" maxLength={200} value={userTexts.titleFull}
                onChange={e => setUserTexts(t => ({ ...t, titleFull: e.target.value }))} />
            </div>
            <div>
              <label className="pp-label">Описание / аннотация (≤ 200 симв.)</label>
              <textarea className="pp-textarea" rows={3} maxLength={200} value={userTexts.annotation}
                onChange={e => setUserTexts(t => ({ ...t, annotation: e.target.value }))} />
            </div>
            <p className="text-xs pp-muted">Если заполнены все три поля — AI-генерация текстов пропускается</p>
          </div>
        )}
      </div>

      {/* GAP-03: photo upload with type tagging */}
      <div className="mb-4">
        <label className="pp-label">Фото молда{isEdit ? ' (необязательно при редактировании)' : <span aria-hidden="true" style={{ color: 'var(--clay-dark)' }}> *</span>}</label>
        <input type="file" multiple accept="image/*" className="pp-input"
          onChange={onFilesChange} />
        {photoError && <p className="text-xs mt-1" style={{ color: 'var(--clay-dark)' }}>Прикрепите хотя бы одно фото молда</p>}
        {photoFiles.length > 0 && (
          <div className="flex flex-col gap-1 mt-2">
            {photoFiles.map(f => (
              <div key={f.name} className="flex items-center gap-3 text-xs">
                <span className="pp-muted flex-1 truncate">{f.name}</span>
                <select
                  className="pp-select" style={{ width: 'auto', fontSize: 12, padding: '3px 6px' }}
                  value={photoTypes[f.name] || 'mold'}
                  onChange={e => setPhotoTypes(prev => ({ ...prev, [f.name]: e.target.value }))}>
                  {PHOTO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            ))}
            <p className="text-xs pp-muted mt-1">Тип определяет, к какому слайду автоматически прикрепится фото</p>
          </div>
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

      <button
        className="pp-btn pp-btn-primary"
        disabled={loading}
        onClick={() => {
          setSubmitted(true);
          const isValid = form.moldName && (isEdit || (form.article && photoFiles.length > 0));
          if (!isValid) return;
          onSubmit(buildQuestionnaire(), photoFiles, photoTypes);
        }}>
        {isEdit
          ? <><Save size={14} aria-hidden="true" /> {loading ? 'Обновляем…' : 'Обновить и перезапустить'}</>
          : <><Plus size={14} aria-hidden="true" /> {loading ? 'Запускаем…' : 'Сохранить и запустить пайплайн'}</>}
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
  const [runningSteps, setRunningSteps] = useState({});
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput]     = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // { id, name }
  const [questionnaireData, setQuestionnaireData] = useState(null); // loaded when Опросник tab opens

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

  const line         = activeLineId ? (lines.find((l) => l.id === activeLineId) ?? null) : null;
  const versions     = manifests[activeLineId] ? manifestToVersions(manifests[activeLineId]) : {};
  const stepVersions = versions[activeStep] || [];
  const currentVersion = versionState[`${activeLineId}.${activeStep}`] ?? stepVersions[stepVersions.length - 1]?.v;

  // Clear optimistic-running flags once the manifest shows the step reached a terminal state
  // (done / error / review). Runs whenever the active line's manifest updates (after each poll). (D-01/D-02)
  useEffect(() => {
    if (!activeLineId) return;
    const manifest = manifests[activeLineId];
    if (!manifest) return;
    setRunningSteps(prev => {
      let changed = false;
      const next = { ...prev };
      for (const key of Object.keys(prev)) {
        const [lineId, stepKey] = key.split('.');
        if (lineId !== activeLineId) continue;
        const { state } = computeStepStatus(stepKey, manifest, line?.sizes);
        if (state === 'done' || state === 'error' || state === 'review') {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [manifests, activeLineId, line]);

  // Count steps currently flagged running for the active line — drives the polling interval. (D-01)
  const runningCount = Object.keys(runningSteps).filter(k => k.startsWith(`${activeLineId}.`)).length;

  // Poll the manifest every 5s while any step on the active line is running; stop when none are. (D-01)
  useEffect(() => {
    if (!activeLineId || runningCount === 0) return undefined;
    const id = setInterval(() => refreshManifest(activeLineId), 5000);
    return () => clearInterval(id);
  }, [activeLineId, runningCount, refreshManifest]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  // Optimistic-running flag for the images step, driven by the existing 5s poll (D-01/D-02).
  const markImagesRunning = useCallback(() => {
    if (!activeLineId) return;
    setRunningSteps((s) => ({ ...s, [`${activeLineId}.images`]: true }));
  }, [activeLineId]);

  const handleRegenerateStep = async () => {
    const stepId = STEP_KEY_TO_ID[activeStep];
    showToast(`Шаг «${STEPS.find((s) => s.key === activeStep).label}» перезапускается…`);
    try {
      await apiFetch(`/lines/${activeLineId}/steps/${stepId}/regenerate`, { method: 'POST', body: JSON.stringify({ force: true }) });
      showToast('Перегенерация запущена — обновится автоматически');
      // Optimistic running for async steps (texts/images) — polling (effect below) confirms/clears it (D-01/D-02).
      if (activeStep === 'texts' || activeStep === 'images') {
        setRunningSteps(s => ({ ...s, [`${activeLineId}.${activeStep}`]: true }));
      }
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

  const renameLine = async (id, name) => {
    await apiFetch(`/lines/${id}/rename`, { method: 'POST', body: JSON.stringify({ name }) });
    setLines(prev => prev.map(l => l.id === id ? { ...l, name } : l));
  };

  const saveLineName = async () => {
    const trimmed = nameInput.trim();
    setEditingName(false);
    if (trimmed && line && trimmed !== line.name) {
      try { await renameLine(line.id, trimmed); }
      catch { showToast('Не удалось сохранить название'); }
    }
  };

  // CRUD-01: delete line + all its artifacts
  const deleteLine = async (id) => {
    try {
      await apiFetch(`/lines/${id}`, { method: 'DELETE' });
      setLines(prev => prev.filter(l => l.id !== id));
      if (activeLineId === id) {
        const remaining = lines.filter(l => l.id !== id);
        setActiveLineId(remaining[0]?.id ?? null);
        setActiveTab('results');
      }
      showToast('Линейка удалена');
    } catch (err) {
      showToast(`Ошибка удаления: ${err.message}`);
    } finally {
      setConfirmDelete(null);
    }
  };

  // CRUD-02: load questionnaire when "Опросник" tab opens for an existing line
  const openQuestionnaireTab = useCallback(async (lineId) => {
    setActiveTab('form');
    setQuestionnaireData(null);
    const manifest = manifests[lineId] || await apiFetch(`/lines/${lineId}/manifest`).catch(() => null);
    const history  = manifest?.steps?.['01-normalize']?.history ?? [];
    const last     = [...history].reverse().find(h => h.questionnaire);
    setQuestionnaireData(last?.questionnaire ?? null);
  }, [manifests]);

  // CRUD-02: submit updated questionnaire via PUT
  const handleUpdateQuestionnaire = async (questionnaire, photoFiles, photoTypes) => {
    setFormLoading(true);
    try {
      if (photoFiles && photoFiles.length > 0) {
        // Re-upload new photos alongside the update
        const fd = new FormData();
        fd.append('questionnaire', JSON.stringify(questionnaire));
        fd.append('photoTypes', JSON.stringify(photoTypes || {}));
        fd.append('force', 'true');
        for (const f of photoFiles) fd.append('photos', f, f.name);
        const res = await fetch(`${API_BASE}/lines`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`POST /lines → ${res.status}`);
      } else {
        await apiFetch(`/lines/${activeLineId}/questionnaire`, { method: 'PUT', body: JSON.stringify(questionnaire) });
      }
      showToast('Опросник обновлён, нормализация перезапущена');
      setActiveTab('results');
      refreshManifest(activeLineId);
    } catch (err) {
      showToast(`Ошибка обновления: ${err.message}`);
    } finally {
      setFormLoading(false);
    }
  };

  const handleFormSubmit = async (questionnaire, photoFiles, photoTypes) => {
    setFormLoading(true);
    try {
      const res = await submitQuestionnaire(questionnaire, photoFiles, photoTypes);
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
      case 'normalize': return <NormalizeView line={line} manifest={manifests[activeLineId]} showToast={showToast} />;
      case 'texts': return <TextsView line={line} manifest={manifests[activeLineId]} />;
      case 'images': return <ImagesView line={line} manifest={manifests[activeLineId]} showToast={showToast} onImagesRunning={markImagesRunning} />;
      case 'video': return <VideoView line={line} manifest={manifests[activeLineId]} onRegenItem={handleRegenerateItem} />;
      case 'excel': return <ExcelView line={line} manifest={manifests[activeLineId]} showToast={showToast} />;
      case 'assemble': return <AssembleView line={line} manifest={manifests[activeLineId]} />;
      default: return null;
    }
  };

  return (
    <div className="pp-root" style={{ minHeight: 600 }}>
      <style>{STYLES}</style>

      {/* CRUD-01: delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="pp-card rounded-lg p-6" style={{ maxWidth: 360, width: '90%' }}>
            <h3 className="pp-display text-lg mb-2" style={{ fontWeight: 500 }}>Удалить линейку?</h3>
            <p className="text-sm pp-muted mb-4">«{confirmDelete.name}» и все её артефакты будут удалены из облака. Это действие нельзя отменить.</p>
            <div className="flex gap-2 justify-end">
              <button className="pp-btn" onClick={() => setConfirmDelete(null)}>Отмена</button>
              <button className="pp-btn" style={{ background: 'var(--clay)', color: '#fff', borderColor: 'var(--clay)' }}
                onClick={() => deleteLine(confirmDelete.id)}>
                <Trash2 size={13} /> Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex" style={{ minHeight: 600 }}>
        <aside className="pp-line border-r p-4" style={{ width: 220, flexShrink: 0 }}>
          <div className="pp-display text-sm mb-4 pp-muted" style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>Линейки молдов</div>
          {listError && (
            <p className="text-sm mb-3" style={{ color: 'var(--clay-dark)', lineHeight: 1.5 }}>{listError}</p>
          )}
          <div className="flex flex-col gap-1">
            {listLoading ? (
              [0, 1, 2].map((i) => (
                <div key={i} style={{ height: 44, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--paper)' }} />
              ))
            ) : (
              lines.map((l) => (
                <div key={l.id} className="relative group">
                  <button
                    onClick={() => { setActiveLineId(l.id); setActiveTab('results'); setActiveStep('normalize'); }}
                    className="rounded-lg p-2 text-left w-full"
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
                  {/* CRUD-01: delete button, visible on hover */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete({ id: l.id, name: l.name }); }}
                    className="pp-btn-ghost"
                    title="Удалить линейку"
                    style={{ position: 'absolute', top: 4, right: 4, opacity: 0, transition: 'opacity 0.15s', padding: 3 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                    aria-label={`Удалить линейку ${l.name}`}
                  >
                    <Trash2 size={12} style={{ color: 'var(--clay-dark)' }} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
          <button className="pp-btn mt-3 w-full" onClick={() => { setActiveLineId(null); setActiveTab('form'); setQuestionnaireData(null); }} style={{ justifyContent: 'center' }}>
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

          {/* New line form (no active line) */}
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
                {editingName ? (
                  <input autoFocus className="pp-display text-2xl"
                    style={{ fontWeight: 500, background: 'transparent', border: 'none', borderBottom: '2px solid var(--lavender)', outline: 'none', minWidth: 120, padding: '0 2px' }}
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveLineName(); if (e.key === 'Escape') setEditingName(false); }}
                    onBlur={saveLineName} />
                ) : (
                  <h1 className="pp-display text-2xl" style={{ fontWeight: 500, cursor: 'text' }}
                    title="Нажмите для переименования"
                    onClick={() => { setNameInput(line.name); setEditingName(true); }}>
                    {line.name}
                  </h1>
                )}
                <span className="pp-mono text-sm pp-muted">{line.id}</span>
                <SizeLadder sizes={line.sizes} dim={5} />
              </div>
              <p className="text-sm pp-muted mt-1">{line.theme} · {line.color}</p>
            </div>
            <div className="flex items-center gap-2">
              <a href={`/lines/${line.id}/download`} download={`${line.id}.zip`}
                title="Скачать все артефакты"
                className="pp-btn pp-btn-ghost text-sm flex items-center gap-1"
                style={{ padding: '6px 10px' }}>
                <Download size={14} /> Скачать всё
              </a>
              <div className="flex gap-1 pp-line border rounded-lg p-1">
                <button onClick={() => setActiveTab('results')}
                  className="text-sm px-3 py-1.5 rounded-md"
                  style={{ background: activeTab === 'results' ? 'var(--lavender)' : 'transparent', color: activeTab === 'results' ? '#fff' : 'var(--ink)' }}>
                  Результаты
                </button>
                {/* CRUD-02: Опросник tab loads existing questionnaire */}
                <button onClick={() => openQuestionnaireTab(activeLineId)}
                  className="text-sm px-3 py-1.5 rounded-md"
                  style={{ background: activeTab === 'form' ? 'var(--lavender)' : 'transparent', color: activeTab === 'form' ? '#fff' : 'var(--ink)' }}>
                  Опросник
                </button>
              </div>
            </div>
          </div>

          {/* CRUD-02: edit mode for existing line */}
          {activeTab === 'form' ? (
            <QuestionnaireForm
              onSubmit={handleUpdateQuestionnaire}
              loading={formLoading}
              initialData={questionnaireData}
              isEdit={true}
            />
          ) : (
            <>
              <StepperNav active={activeStep} onSelect={setActiveStep} lineId={activeLineId} manifests={manifests} line={line} runningSteps={runningSteps} />
              <div className="my-3 flex items-center gap-3 flex-wrap">
                <VersionPicker
                  versions={stepVersions}
                  value={currentVersion}
                  onChange={(v) => setVersionState((s) => ({ ...s, [`${activeLineId}.${activeStep}`]: v }))}
                  onRegenerate={handleRegenerateStep}
                />
                <button className="pp-btn" onClick={() => refreshManifest(activeLineId)}>
                  <RotateCcw size={14} aria-hidden="true" /> Обновить статус
                </button>
              </div>
              {(() => {
                const activeStatus = computeStepStatus(activeStep, manifests[activeLineId], line?.sizes);
                if (activeStatus.state !== 'error') return null;
                const errMsg = manifests[activeLineId]?.steps?.[STEP_KEY_TO_ID[activeStep]]?.error;
                return (
                  <div className="pp-card rounded-lg p-4 mb-3" style={{ borderColor: 'var(--clay)', background: 'var(--clay-soft)' }}>
                    <p className="text-sm mb-3" style={{ color: 'var(--clay-dark)', lineHeight: 1.5 }}>Ошибка шага: {errMsg}</p>
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
