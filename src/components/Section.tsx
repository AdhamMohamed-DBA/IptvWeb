import type { ReactNode } from "react";

interface SectionProps {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}

export default function Section({ title, right, children }: SectionProps) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
