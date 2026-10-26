import { useEffect, useRef, type MouseEvent } from "react";

interface Props {
  peaks: Float32Array; // interleaved min/max pairs from computePeaks
  progress: number; // 0 … 1
  color: string;
  dimmed?: boolean;
  height?: number;
  onSeek: (fraction: number) => void;
}

// The canvas is only redrawn when the peaks or size change; the playhead and
// "played" shading are plain divs, so 60 fps playback doesn't repaint the canvas.
export default function Waveform({ peaks, progress, color, dimmed, height = 56, onSeek }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = color;

      const buckets = peaks.length / 2;
      const mid = canvas.height / 2;
      for (let x = 0; x < canvas.width; x++) {
        // Each pixel column covers a range of buckets; draw its overall min..max.
        const from = Math.floor((x / canvas.width) * buckets);
        const to = Math.max(from + 1, Math.floor(((x + 1) / canvas.width) * buckets));
        let min = 0;
        let max = 0;
        for (let b = from; b < to && b < buckets; b++) {
          min = Math.min(min, peaks[b * 2]);
          max = Math.max(max, peaks[b * 2 + 1]);
        }
        const top = mid - max * mid;
        const bottom = mid - min * mid;
        ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [peaks, color, height]);

  function onClick(e: MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  }

  const percent = `${(progress * 100).toFixed(3)}%`;
  return (
    <div
      ref={containerRef}
      className={`waveform${dimmed ? " dimmed" : ""}`}
      style={{ height }}
      onClick={onClick}
    >
      <canvas ref={canvasRef} />
      <div className="played" style={{ width: percent }} />
      <div className="playhead" style={{ left: percent }} />
    </div>
  );
}
