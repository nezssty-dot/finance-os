import { useState } from 'react'
import { useFetch } from '@/hooks/useFetch'
import { api } from '@/lib/api'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Modal, Input, Select, EmptyState, AsyncGate } from '@/components/ui'

/**
 * Gestión de categorías.
 *
 * Antes las categorías solo nacían solas (al importar o con las reglas semilla) y no había
 * dónde manejarlas: por eso se sentían "fijas". Acá se crean, se renombran, se les pone
 * color e icono, se borran y —lo más útil después de importar varios meses— se FUSIONAN
 * las que son la misma cosa escrita distinto.
 *
 * Nada se borra en silencio: antes de eliminar, la pantalla dice exactamente qué pasa con
 * los movimientos y con los presupuestos que la usan.
 */

interface CategoryStat {
  id: string
  name: string
  color: string
  icon: string | null
  movements: number
  budgets: number
}
interface DuplicateGroup {
  keep: { id: string; name: string; count?: number }
  merge: { id: string; name: string; count?: number }[]
}
interface StatsResponse {
  items: CategoryStat[]
  uncategorized: number
  duplicates: DuplicateGroup[]
}

const COLORS = [
  '#d4a53a', '#5b9bd4', '#5bbf7a', '#d9615c', '#b06fd4',
  '#d4915b', '#4fb3a8', '#c96b9a', '#8a8a8a',
]

const ICONS = [
  '🏠', '🚗', '🍔', '🛒', '💊', '🎮', '✈️', '📱', '💡', '🎓',
  '👕', '🐶', '🎬', '🎵', '💼', '🏋️', '☕', '⛽', '🎁', '💰',
]

export function Categorias() {
  const { data, loading, error, refetch } = useFetch<StatsResponse>('/categories/stats')
  const [editing, setEditing] = useState<CategoryStat | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<CategoryStat | null>(null)
  const [merging, setMerging] = useState<CategoryStat | null>(null)
  const [saving, setSaving] = useState(false)

  // Estado del formulario (sirve para crear y para editar).
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [icon, setIcon] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')

  if (loading && !data) return <AsyncGate title="Categorías" />
  if (!data) return <AsyncGate title="Categorías" error={error} onRetry={refetch} />

  const cats = data.items ?? []

  function openCreate() {
    setName(''); setColor(COLORS[0]); setIcon(null); setCreating(true)
  }
  function openEdit(c: CategoryStat) {
    setName(c.name); setColor(c.color); setIcon(c.icon); setEditing(c)
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const body = { name: name.trim(), color, icon: icon ?? null }
      if (editing) await api(`/categories/${editing.id}`, { method: 'PATCH', body })
      else await api('/categories', { method: 'POST', body })
      setCreating(false); setEditing(null); refetch()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar')
    }
    setSaving(false)
  }

  async function remove() {
    if (!deleting) return
    setSaving(true)
    try {
      await api(`/categories/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null); refetch()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo borrar')
    }
    setSaving(false)
  }

  async function doMerge(sourceId: string, targetId: string) {
    setSaving(true)
    try {
      await api(`/categories/${sourceId}/merge`, { method: 'POST', body: { targetId } })
      setMerging(null); setMergeTarget(''); refetch()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo fusionar')
    }
    setSaving(false)
  }

  const form = (
    <>
      <Input label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="COMIDA" autoFocus />
      <div className="mb-3.5">
        <label className="block text-xs font-semibold text-txt-2 mb-1.5">Icono</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setIcon(null)}
            className={`w-9 h-9 rounded-[9px] border text-[11px] flex items-center justify-center transition-colors ${icon === null ? 'border-gold-line bg-gold-dim text-gold-2' : 'border-line text-txt-3 hover:border-txt-3'}`}
          >
            —
          </button>
          {ICONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setIcon(e)}
              className={`w-9 h-9 rounded-[9px] border text-base flex items-center justify-center transition-colors ${icon === e ? 'border-gold-line bg-gold-dim' : 'border-line hover:border-txt-3'}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3.5">
        <label className="block text-xs font-semibold text-txt-2 mb-1.5">Color</label>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-8 h-8 rounded-full border-2 transition-transform ${color === c ? 'border-txt scale-110' : 'border-transparent'}`}
              style={{ background: c }}
              aria-label={c}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2 mt-5">
        <Button variant="primary" onClick={save} loading={saving} className="flex-1">
          {editing ? 'Guardar cambios' : 'Crear categoría'}
        </Button>
        <Button onClick={() => { setCreating(false); setEditing(null) }}>Cancelar</Button>
      </div>
    </>
  )

  return (
    <>
      <TopBar title="Categorías" sub="Creá y ordená tus categorías" />
      <div className="p-7 animate-fade-in">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Button variant="primary" onClick={openCreate}>+ Nueva categoría</Button>
          <span className="text-[12px] text-txt-3">
            {cats.length} {cats.length === 1 ? 'categoría' : 'categorías'}
            {data.uncategorized > 0 && ` · ${data.uncategorized} movimientos sin categoría`}
          </span>
        </div>

        {data.duplicates?.length > 0 && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold mb-1">Categorías repetidas</h3>
            <p className="text-[12px] text-txt-3 mb-3">
              Estas parecen la misma cosa escrita distinto. Fusionarlas mueve los movimientos
              a la que conservás y no se pierde nada.
            </p>
            <div className="space-y-2">
              {data.duplicates.map((g) => (
                <div key={g.keep.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] border border-line">
                  <span className="text-[13px] flex-1 min-w-0">
                    <b>{g.keep.name}</b>
                    <span className="text-txt-3"> ← {g.merge.map((m) => m.name).join(', ')}</span>
                  </span>
                  <Button
                    onClick={() => g.merge.forEach((m) => doMerge(m.id, g.keep.id))}
                    disabled={saving}
                  >
                    Fusionar
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <h3 className="text-sm font-semibold mb-3">Mis categorías</h3>
          {cats.length ? cats.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-3 border-b border-bg-2 last:border-0">
              <div
                className="w-9 h-9 rounded-[9px] flex items-center justify-center text-[13px] font-bold shrink-0"
                style={{ background: c.color + '2a', color: c.color }}
              >
                {c.icon || c.name.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[13px]">{c.name}</div>
                <div className="text-[11px] text-txt-3">
                  {c.movements} {c.movements === 1 ? 'movimiento' : 'movimientos'}
                  {c.budgets > 0 && ` · ${c.budgets} ${c.budgets === 1 ? 'presupuesto' : 'presupuestos'}`}
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button onClick={() => openEdit(c)}>Editar</Button>
                {cats.length > 1 && (
                  <Button onClick={() => { setMerging(c); setMergeTarget('') }}>Fusionar</Button>
                )}
                <Button onClick={() => setDeleting(c)}>Borrar</Button>
              </div>
            </div>
          )) : (
            <EmptyState
              icon="🏷️"
              title="Sin categorías"
              description="Creá tu primera categoría para empezar a ordenar los movimientos."
              action={<Button variant="primary" onClick={openCreate}>Crear categoría</Button>}
            />
          )}
        </Card>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Nueva categoría">
        {form}
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar categoría">
        {form}
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Borrar ${deleting?.name ?? ''}`}
      >
        <p className="text-[13px] text-txt-2 leading-relaxed mb-2">
          {deleting && deleting.movements > 0
            ? `Sus ${deleting.movements} ${deleting.movements === 1 ? 'movimiento queda' : 'movimientos quedan'} sin categoría. No se borra ningún movimiento.`
            : 'No hay movimientos usando esta categoría.'}
        </p>
        {deleting && deleting.budgets > 0 && (
          <p className="text-[13px] text-danger leading-relaxed mb-2">
            Se {deleting.budgets === 1 ? 'elimina su presupuesto' : `eliminan sus ${deleting.budgets} presupuestos`}.
          </p>
        )}
        <p className="text-[12px] text-txt-3 mb-4">
          Si en vez de borrarla querés conservar los movimientos ordenados, fusionala con otra.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={remove} loading={saving} className="flex-1">Borrar</Button>
          <Button onClick={() => setDeleting(null)}>Cancelar</Button>
        </div>
      </Modal>

      <Modal
        open={!!merging}
        onClose={() => setMerging(null)}
        title={`Fusionar ${merging?.name ?? ''}`}
        sub="Sus movimientos pasan a la categoría que elijas"
      >
        <Select label="Fusionar en" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
          <option value="">Elegí una categoría…</option>
          {cats.filter((c) => c.id !== merging?.id).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <p className="text-[12px] text-txt-3 mb-4">
          {merging?.movements ?? 0} movimientos se mueven. Lo que el sistema aprendió sobre esta
          categoría se conserva. La categoría vacía se elimina.
        </p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            onClick={() => merging && mergeTarget && doMerge(merging.id, mergeTarget)}
            loading={saving}
            disabled={!mergeTarget}
            className="flex-1"
          >
            Fusionar
          </Button>
          <Button onClick={() => setMerging(null)}>Cancelar</Button>
        </div>
      </Modal>
    </>
  )
}
