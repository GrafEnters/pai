import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { api, errText, type Category, type Tag } from '../api';

export function Structure() {
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-white">Структура</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Categories />
        <Tags />
      </div>
    </div>
  );
}

function Categories() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<Category[]>('/admin/categories')).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post('/admin/categories', { title, sortOrder: categories.length * 10 })).data,
    onSuccess: () => {
      setTitle('');
      setError('');
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => setError(errText(e)),
  });

  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: number; title: string }) =>
      (await api.patch(`/admin/categories/${id}`, { title })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
    onError: (e) => setError(errText(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/admin/categories/${id}`)).data,
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => setError(errText(e)),
  });

  const reorder = useMutation({
    mutationFn: async (items: { id: number; sortOrder: number }[]) =>
      (await api.post('/admin/categories/reorder', { items })).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['categories'] }),
  });

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex((c) => c.id === active.id);
    const newIndex = categories.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = [...categories];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved!);
    reorder.mutate(next.map((c, i) => ({ id: c.id, sortOrder: i * 10 })));
  }

  return (
    <div className="card p-4">
      <h2 className="mb-3 font-medium text-white">Категории</h2>

      <div className="mb-3 flex gap-2">
        <input
          className="input"
          placeholder="Новая категория"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && create.mutate()}
        />
        <button className="btn-primary px-3" disabled={!title.trim()} onClick={() => create.mutate()}>
          <Plus size={16} />
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={categories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {categories.map((c) => (
              <SortableRow key={c.id} id={c.id}>
                <input
                  className="flex-1 bg-transparent text-sm text-ink-200 outline-none"
                  defaultValue={c.title}
                  onBlur={(e) => e.target.value !== c.title && rename.mutate({ id: c.id, title: e.target.value })}
                />
                <span className="text-xs text-ink-600">{c.guideCount ?? 0}</span>
                <button
                  className="text-ink-600 hover:text-red-300"
                  title="Удалить"
                  onClick={() => remove.mutate(c.id)}
                >
                  <Trash2 size={14} />
                </button>
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <p className="mt-3 text-xs text-ink-600">
        Порядок задаётся перетаскиванием. Категорию с гайдами удалить нельзя — сначала перенесите их.
      </p>
    </div>
  );
}

function SortableRow({ id, children }: { id: number; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-lg border border-ink-800 bg-ink-950 px-2 py-1.5 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <button className="cursor-grab text-ink-600" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </button>
      {children}
    </div>
  );
}

function Tags() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => (await api.get<Tag[]>('/admin/tags')).data,
  });

  const create = useMutation({
    mutationFn: async () => (await api.post('/admin/tags', { title })).data,
    onSuccess: () => {
      setTitle('');
      void qc.invalidateQueries({ queryKey: ['tags'] });
    },
    onError: (e) => setError(errText(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/admin/tags/${id}`)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tags'] }),
    onError: (e) => setError(errText(e)),
  });

  return (
    <div className="card p-4">
      <h2 className="mb-3 font-medium text-white">Теги</h2>

      <div className="mb-3 flex gap-2">
        <input
          className="input"
          placeholder="Новый тег"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && title.trim() && create.mutate()}
        />
        <button className="btn-primary px-3" disabled={!title.trim()} onClick={() => create.mutate()}>
          <Plus size={16} />
        </button>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span key={t.id} className="badge flex items-center gap-1.5 bg-ink-800 text-ink-300">
            {t.title}
            <span className="text-ink-600">{t.guideCount ?? 0}</span>
            <button className="text-ink-600 hover:text-red-300" onClick={() => remove.mutate(t.id)}>
              <Trash2 size={12} />
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-sm text-ink-600">Тегов пока нет</span>}
      </div>
    </div>
  );
}
