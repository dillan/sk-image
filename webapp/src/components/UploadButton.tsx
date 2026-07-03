import { useRef, useState } from 'react';
import { api } from '../api';
import type { PluginConfig } from '../api';
import { UploadIcon } from './icons';

export function UploadButton({
  config,
  onUploaded,
}: {
  config: PluginConfig | null;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxBytes = config?.maxUploadBytes ?? 10 * 1024 * 1024;

  const onFile = async (file: File) => {
    setError(null);
    if (file.size > maxBytes) {
      setError(`"${file.name}" is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      return;
    }
    setProgress(0);
    try {
      await api.upload(file, setProgress);
      onUploaded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="toolbar" style={{ margin: 0 }}>
      {progress !== null && (
        <div className="bar" style={{ width: 120 }}>
          <div className="bar__fill" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <span className="chip chip--caution">{error}</span>}
      <button
        type="button"
        className="btn btn--primary"
        disabled={progress !== null}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon width={18} height={18} /> Upload
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.svg,.heic"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
