"use client";

import { useEffect, useRef, useState } from "react";

interface TypeWriterProps {
  text: string;
  /** 每个字的打印间隔 ms，默认 80 */
  speed?: number;
  /** 开始前等待 ms，默认 300 */
  delay?: number;
  className?: string;
  /** 是否显示光标，默认 true */
  cursor?: boolean;
  as?: keyof JSX.IntrinsicElements;
}

export default function TypeWriter({
  text,
  speed = 80,
  delay = 300,
  className,
  cursor = true,
  as: Tag = "span",
}: TypeWriterProps) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    indexRef.current = 0;

    const start = setTimeout(() => {
      const id = setInterval(() => {
        const next = indexRef.current + 1;
        setDisplayed(text.slice(0, next));
        indexRef.current = next;
        if (next >= text.length) {
          clearInterval(id);
          setDone(true);
        }
      }, speed);
      return () => clearInterval(id);
    }, delay);

    return () => clearTimeout(start);
  }, [text, speed, delay]);

  return (
    // @ts-ignore — dynamic tag
    <Tag className={className}>
      {displayed}
      {cursor && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "2px",
            height: "0.85em",
            background: "var(--accent)",
            marginLeft: "3px",
            verticalAlign: "middle",
            borderRadius: "1px",
            animation: "none",
            opacity: done ? 0 : 1,
            transition: "opacity 0.3s ease",
          }}
        />
      )}
    </Tag>
  );
}
