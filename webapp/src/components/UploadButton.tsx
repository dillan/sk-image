import { UploadIcon } from './icons';

/**
 * Opens the OS file picker and hands the chosen files to the upload queue.
 *
 * A real `<label>` wraps the input so tapping natively triggers the picker — programmatic
 * `input.click()` on a hidden input is unreliable in iOS Safari and embedded webviews (the Signal K
 * admin serves this app in one). `accept="image/*"` with no `capture` makes iOS offer Photo Library,
 * Take Photo, and Choose File; HEIC and SVG both match it, and the server validates by content
 * regardless. The input is visually hidden but kept in the layout/a11y tree so it stays keyboard
 * focusable (`:focus-within` puts the ring on the label).
 */
export function UploadButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <label className="btn btn--primary">
      <UploadIcon width={18} height={18} /> Upload
      <input
        type="file"
        accept="image/*"
        multiple
        className="visually-hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = ''; // allow re-picking the same file
        }}
      />
    </label>
  );
}
