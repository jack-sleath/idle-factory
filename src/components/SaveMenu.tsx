import { useRef, useState } from 'react'
import { useGameStore } from '../store/gameStore'

const SAVE_FILENAME = 'idle-factory-save.json'

/** Trigger a client-side download of `text` as a file (no server involved). */
function downloadFile(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Manual save management (M8): Save/Load against localStorage, plus Export to a
 * JSON file and Import from one. Opened from the HUD; shows a short status line.
 */
export function SaveMenu({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleSave = () => {
    useGameStore.getState().saveNow()
    setStatus('Saved to this browser.')
  }

  const handleLoad = () => {
    setStatus(useGameStore.getState().loadFromStorage() ? 'Loaded last save.' : 'No save found.')
  }

  const handleExport = () => {
    downloadFile(SAVE_FILENAME, useGameStore.getState().exportSaveString())
    setStatus(`Exported ${SAVE_FILENAME}.`)
  }

  const handleImportFile = async (file: File) => {
    const text = await file.text()
    setStatus(useGameStore.getState().importSave(text) ? 'Imported save.' : 'Import failed: invalid file.')
  }

  return (
    <aside className="panel panel--save" aria-label="Save management">
      <header className="panel__head">
        <span className="panel__title">💾 Saves</span>
        <button type="button" className="panel__close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="save__actions">
        <button type="button" className="save__btn" onClick={handleSave}>
          Save
        </button>
        <button type="button" className="save__btn" onClick={handleLoad}>
          Load
        </button>
        <button type="button" className="save__btn" onClick={handleExport}>
          Export
        </button>
        <button type="button" className="save__btn" onClick={() => fileRef.current?.click()}>
          Import
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleImportFile(file)
          e.target.value = '' // allow re-importing the same file
        }}
      />
      {status && <p className="save__status">{status}</p>}
    </aside>
  )
}
