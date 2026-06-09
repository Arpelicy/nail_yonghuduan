import type { Box, TargetNail } from "./types";

export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export function boxStyle(box: Box): React.CSSProperties {
  return {
    left: `${box.x}%`,
    top: `${box.y}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
    transform: `rotate(${box.rotation ?? 0}deg)`,
    transformOrigin: "center center",
  };
}

export function nextRotation(current: number): number {
  return (current + 90) % 360;
}

export function computeLongNailBox(nail: TargetNail, multiplier: number): Box {
  const box = nail.currentBox;
  const extraHeight = box.height * (multiplier - 1);
  const dx = nail.directionVector.x * extraHeight;
  const dy = nail.directionVector.y * extraHeight;
  return {
    ...box,
    x: box.x + dx,
    y: box.y + dy,
    height: box.height * multiplier,
  };
}
