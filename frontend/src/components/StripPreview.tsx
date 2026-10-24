import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../services/api";
import type { SourceImage } from "../types/project";

interface Props {
  projectId: string;
  image: SourceImage;
  scale: number;
  stage: RefObject<HTMLDivElement | null>;
}

export const StripPreview = memo(function StripPreview({ projectId, image, scale, stage }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!surface.current || !stage.current) return;
    const observer = new IntersectionObserver((entries) => {
      setVisible((previous) => {
        const next = new Set(previous);
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.pageId!;
          if (entry.isIntersecting) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    }, { root: stage.current, rootMargin: "800px" });
    surface.current.querySelectorAll("[data-page-id]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [image.id, image.stripPages, stage]);

  return <div className="strip-preview" ref={surface}>
    {image.stripPages?.map((page, index) => <div className="strip-page" key={page.id} data-page-id={page.id}
      style={{ top: page.top * scale, height: page.stripHeight * scale }}>
      {visible.has(page.id) && <img src={api.stripPageUrl(projectId, image.id, page.id)}
        alt={`Page ${index + 1}`} draggable={false} decoding="async"
        onError={() => setFailed((previous) => new Set(previous).add(page.id))}
        onLoad={() => setFailed((previous) => {
          if (!previous.has(page.id)) return previous;
          const next = new Set(previous); next.delete(page.id); return next;
        })} />}
      {visible.has(page.id) && failed.has(page.id) && <span className="strip-page-error">Could not load page {index + 1}</span>}
    </div>)}
  </div>;
});
