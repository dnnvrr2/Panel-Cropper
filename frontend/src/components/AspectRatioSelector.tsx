import { ASPECT_RATIOS } from "../utils/aspectRatios";
import type { AspectRatio } from "../types/project";

interface Props {
  value: AspectRatio;
  onChange: (ratio: AspectRatio) => void;
}

export function AspectRatioSelector({ value, onChange }: Props) {
  return (
    <div className="ratio-selector" aria-label="Aspect ratio">
      {ASPECT_RATIOS.map((item) => (
        <button
          key={item.label}
          className={value === item.label ? "active" : ""}
          onClick={() => onChange(item.label)}
          title={`${item.label} (${item.shortcut})`}
        >
          <span className={`ratio-icon ratio-${item.label.replace(":", "-")}`} />
          {item.label}
          <kbd>{item.shortcut}</kbd>
        </button>
      ))}
    </div>
  );
}

