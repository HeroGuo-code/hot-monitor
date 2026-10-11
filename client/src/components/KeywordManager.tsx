import { useState } from 'react';
import { Flame, Plus, Power, Trash2, Loader2 } from 'lucide-react';
import { keywordsApi, type Keyword } from '../services/api';

interface Props {
  keywords: Keyword[];
  onChanged: () => void;
  onError: (message: string) => void;
}

/** 关键词管理面板：添加 / 激活暂停 / 删除 */
export default function KeywordManager({ keywords, onChanged, onError }: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      await keywordsApi.create({ text: value });
      setText('');
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : '添加失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (kw: Keyword) => {
    try {
      await keywordsApi.toggle(kw.id);
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : '操作失败');
    }
  };

  const handleDelete = async (kw: Keyword) => {
    try {
      await keywordsApi.delete(kw.id);
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : '删除失败');
    }
  };

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Flame size={16} />
          </span>
          <h2 className="text-sm font-semibold text-slate-900">监控关键词</h2>
          <span className="chip bg-slate-100 text-slate-500">{keywords.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="input w-56"
            placeholder="输入关键词，如 Claude 4.6"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button className="btn-primary !px-3" onClick={handleAdd} disabled={!text.trim() || submitting}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
            添加
          </button>
        </div>
      </div>

      {keywords.length === 0 ? (
        <p className="mt-4 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
          还没有监控关键词，添加一个开始盯热点
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {keywords.map(kw => (
            <div
              key={kw.id}
              className={`group flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${
                kw.isActive
                  ? 'border-blue-200 bg-blue-50/60 text-slate-800'
                  : 'border-slate-200 bg-slate-50 text-slate-400'
              }`}
            >
              <button
                title={kw.isActive ? '暂停监控' : '恢复监控'}
                onClick={() => handleToggle(kw)}
                className={`flex items-center gap-1.5 transition ${
                  kw.isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                <Power size={13} strokeWidth={2.5} />
                <span className="font-medium">{kw.text}</span>
              </button>
              <span className={`chip ${kw.isActive ? 'bg-blue-100 text-blue-600' : 'bg-slate-200 text-slate-400'}`}>
                {kw.hotspotCount}
              </span>
              <button
                title="删除"
                onClick={() => handleDelete(kw)}
                className="text-slate-300 transition hover:text-red-500"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
