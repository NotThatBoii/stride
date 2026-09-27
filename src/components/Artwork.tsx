import { useId } from "react";
export function Mountains() {
  const id = useId();
  return (
    <svg className="mountain-art" viewBox="0 0 260 150" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2=".6" y2="1">
          <stop stopColor="#7473ff" />
          <stop offset=".55" stopColor="#343895" />
          <stop offset="1" stopColor="#101320" />
        </linearGradient>
      </defs>
      <path
        fill="#111626"
        d="M0 116 31 91 56 106 92 57 119 88 169 76 214 112 239 99 260 130 260 150 0 150Z"
      />
      <path
        fill={`url(#${id})`}
        d="m35 105 32-40 17 12 27-43 26-16 18 48 25 31 21 10 25 31-98 7Z"
      />
      <path fill="#6264d5" d="m111 34 26-16-16 71-13-24Z" />
      <path fill="#303577" d="m137 18 18 48 25 31-36-20-23 12Z" />
      <path fill="#202650" d="m67 65 17 12 27-43-24 62-15 20Z" />
      <path fill="#3f4395" d="m35 105 32-40 5 51 28 18Z" />
      <path fill="#171d3b" d="m121 89 23-12 36 20 21 10-15 26-58 12Z" />
      <path
        fill="#101520"
        d="m0 120 35-15 40 20 29-13 24 33 58-12 26-23 48 27v13H0Z"
      />
      <path
        fill="none"
        stroke="#414875"
        strokeOpacity=".3"
        d="m0 120 35-15 40 20 29-13 24 33 58-12 26-23 48 27"
      />
    </svg>
  );
}
export function StudyArtwork() {
  const id = useId();
  return (
    <svg className="study-art" viewBox="0 0 300 180" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2=".3" y2="1">
          <stop stopColor="#6870ff" />
          <stop offset=".5" stopColor="#343fce" stopOpacity=".85" />
          <stop offset="1" stopColor="#252b5e" stopOpacity=".15" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="#626caa" strokeOpacity=".12">
        <path d="m40 127 109-63 114 65-110 64Z M66 143l111-64 M94 160l110-65 M45 110l112 65 M99 79l111 66" />
      </g>
      <path
        fill="#333c75"
        opacity=".16"
        d="m95 65 69-40 76 44-72 42Z M95 65v73l73 42v-69Z M168 111v69l72-43V69Z"
      />
      <g fill={`url(#${id})`} stroke="#8890ff" strokeOpacity=".2">
        <path d="M135 63q0-6 5-9l63-37q6-3 6 4v97l-74 43Z" />
        <path d="M66 108q0-4 4-7l18-10q4-3 4 3v42l-26 15Z" />
        <path d="M213 118q0-4 4-7l17-10q4-3 4 3v41l-25 15Z" />
      </g>
      <g fill="none" stroke="#aaaaff" strokeWidth="1.4" opacity=".65">
        <path d="m148 70 8-5 8-1v15l-8 1-8 5Zm8-5v15 M74 113l5-3 5-1v9l-5 1-5 3Zm5-3v9 M220 122l5-3 5-1v9l-5 1-5 3Zm5-3v9" />
      </g>
      <g fill="#8c8eff">
        <circle cx="218" cy="46" r="1.5" />
        <circle cx="231" cy="53" r="1" />
        <circle cx="103" cy="130" r="1" />
      </g>
    </svg>
  );
}
