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
 * Save management (M8): the game autosaves to localStorage, so this panel
 * offers Export to a JSON file / Import from one (for backups and moving
 * between browsers) plus a confirmed Reset. Opened from the HUD; shows a short
 * status line.
 */
export function SaveMenu({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleReset = () => {
    useGameStore.getState().resetGame()
    setConfirmingReset(false)
    setStatus('Game reset to a fresh start.')
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
        <button type="button" className="save__btn" onClick={handleExport}>
          Export
        </button>
        <button type="button" className="save__btn" onClick={() => fileRef.current?.click()}>
          Import
        </button>
      </div>
      <div className="save__reset">
        {confirmingReset ? (
          <div className="save__confirm" role="alertdialog" aria-label="Confirm reset">
            <p className="save__confirm-text">
              Reset the game to a fresh start? This wipes your factory, money, and town — it can't
              be undone. Export first if you want a backup.
            </p>
            <div className="save__confirm-actions">
              <button type="button" className="save__btn save__btn--danger" onClick={handleReset}>
                Reset everything
              </button>
              <button type="button" className="save__btn" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="save__btn save__btn--danger save__btn--wide"
            onClick={() => setConfirmingReset(true)}
          >
            Reset game
          </button>
        )}
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
