import { useRef } from 'react';
import { UploadIcon } from './icons';

/** Opens the file picker (multiple allowed) and hands the chosen files to the upload queue. */
export function UploadButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn--primary" onClick={() => inputRef.current?.click()}>
        <UploadIcon width={18} height={18} /> Upload
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.svg,.heic"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </>
  );
}
