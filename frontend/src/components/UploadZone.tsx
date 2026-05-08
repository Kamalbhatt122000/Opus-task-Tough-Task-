/**
 * Drag-and-drop upload zone for STL files.
 */

import { useState, useRef, useCallback } from 'react';

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  isProcessing: boolean;
  onProcess: () => void;
  hasFile: boolean;
  fileName?: string;
  fileSize?: number;
}

export function UploadZone({
  onFileSelected,
  isProcessing,
  onProcess,
  hasFile,
  fileName,
  fileSize,
}: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.toLowerCase().endsWith('.stl')) {
      onFileSelected(files[0]);
    }
  }, [onFileSelected]);

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelected(files[0]);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-3">
      <div
        id="upload-drop-zone"
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative cursor-pointer rounded-xl border-2 border-dashed
          transition-all duration-300 p-6 text-center
          ${isDragging
            ? 'border-[var(--color-accent)] bg-[rgba(99,102,241,0.08)]'
            : hasFile
              ? 'border-[var(--color-success)] bg-[rgba(52,211,153,0.05)]'
              : 'border-[var(--color-border)] hover:border-[var(--color-accent)] bg-[var(--color-bg-card)]'
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".stl"
          onChange={handleChange}
          className="hidden"
        />

        {hasFile ? (
          <div className="animate-fade-in">
            <div className="w-12 h-12 rounded-full bg-[rgba(52,211,153,0.15)] flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-[var(--color-success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{fileName}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{fileSize ? formatSize(fileSize) : ''}</p>
            <p className="text-xs text-[var(--color-accent)] mt-2 cursor-pointer hover:underline">Click to change file</p>
          </div>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-[var(--color-bg-hover)] flex items-center justify-center mx-auto mb-3">
              <svg className="w-7 h-7 text-[var(--color-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              Drop your STL file here
            </p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">or click to browse</p>
          </>
        )}
      </div>

      <button
        id="process-button"
        onClick={onProcess}
        disabled={!hasFile || isProcessing}
        className={`
          w-full py-3 px-4 rounded-xl font-semibold text-sm
          transition-all duration-300
          ${hasFile && !isProcessing
            ? 'bg-gradient-to-r from-[var(--color-accent)] to-[#a78bfa] text-white hover:shadow-lg hover:shadow-[rgba(99,102,241,0.3)] active:scale-[0.98]'
            : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] cursor-not-allowed'
          }
        `}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path fill="currentColor" className="opacity-75"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading mesh…
          </span>
        ) : (
          '✦ Start: Load Mesh'
        )}
      </button>
    </div>
  );
}
