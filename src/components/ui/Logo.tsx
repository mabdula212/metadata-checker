import React from "react";

export type LogoVariant = "full" | "icon" | "monochrome" | "white";
export type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

export interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  showTagline?: boolean;
  layout?: "stacked" | "inline";
  iconOnlyOnMobile?: boolean;
  className?: string;
}

const SIZE_CONFIG: Record<
  LogoSize,
  {
    iconPx: number;
    titleText: string;
    inlineText: string;
    taglineText: string;
    gap: string;
  }
> = {
  xs: {
    iconPx: 24,
    titleText: "text-[11px] leading-[1.08]",
    inlineText: "text-xs",
    taglineText: "text-[9px]",
    gap: "gap-2",
  },
  sm: {
    iconPx: 34,
    titleText: "text-[13px] leading-[1.06]",
    inlineText: "text-sm",
    taglineText: "text-[10px]",
    gap: "gap-2.5",
  },
  md: {
    iconPx: 42,
    titleText: "text-base leading-[1.06]",
    inlineText: "text-base",
    taglineText: "text-[11px]",
    gap: "gap-3",
  },
  lg: {
    iconPx: 54,
    titleText: "text-xl sm:text-2xl leading-[1.04]",
    inlineText: "text-xl sm:text-2xl",
    taglineText: "text-xs",
    gap: "gap-3.5",
  },
  xl: {
    iconPx: 68,
    titleText: "text-2xl sm:text-3xl leading-[1.04]",
    inlineText: "text-2xl sm:text-3xl",
    taglineText: "text-xs sm:text-sm",
    gap: "gap-4",
  },
};

/**
 * Official Metadata Checker Vector Icon:
 * A. Document / PDF sheet with folded top-right corner
 * B. Metadata lines + 3 ascending financial analytics bars
 * C. Protective security shield with checkmark on the bottom-right
 */
export const LogoMarkSvg: React.FC<{
  sizePx: number;
  variant: LogoVariant;
  decorative?: boolean;
  className?: string;
}> = ({ sizePx, variant, decorative = false, className = "" }) => {
  const isMono = variant === "monochrome";
  const isWhite = variant === "white";

  // Color palette per variant
  const primaryColor = isMono
    ? "#0F172A"
    : isWhite
    ? "#3B82F6"
    : "#2563EB";
  const accentFoldColor = isMono
    ? "#475569"
    : isWhite
    ? "#93C5FD"
    : "#60A5FA";
  const sheetBgColor = isWhite ? "#0F172A" : "#FFFFFF";
  const shieldFill = isMono
    ? "#0F172A"
    : isWhite
    ? "#2563EB"
    : "#2563EB";
  const shieldStroke = isWhite ? "#0F172A" : "#FFFFFF";
  const checkColor = "#FFFFFF";
  const contentColor = isMono
    ? "#0F172A"
    : isWhite
    ? "#60A5FA"
    : "#2563EB";

  return (
    <svg
      width={sizePx}
      height={sizePx}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Metadata Checker"}
      aria-hidden={decorative ? "true" : undefined}
      className={`shrink-0 select-none ${className}`}
    >
      {/* Document Outer Body with Folded Top-Right Corner */}
      <path
        d="M14 6H37L50 19V50C50 54.4183 46.4183 58 42 58H14C9.58172 58 6 54.4183 6 50V14C6 9.58172 9.58172 6 14 6Z"
        fill={sheetBgColor}
        stroke={primaryColor}
        strokeWidth="5"
        strokeLinejoin="round"
      />

      {/* Folded Corner Flap (Top Right) */}
      <path
        d="M36 6.5V16C36 18.2091 37.7909 20 40 20H49.5L36 6.5Z"
        fill={accentFoldColor}
      />
      <path
        d="M36 6.5V16C36 18.2091 37.7909 20 40 20H49.5"
        stroke={primaryColor}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Metadata Horizontal Lines (Top-Left Inside Document) */}
      <rect
        x="14"
        y="19"
        width="15"
        height="4"
        rx="2"
        fill={contentColor}
      />
      <rect
        x="14"
        y="26.5"
        width="20"
        height="4"
        rx="2"
        fill={contentColor}
      />

      {/* Financial Analytics Bar Chart (Bottom-Left Inside Document) */}
      <rect
        x="14"
        y="42"
        width="4.5"
        height="9"
        rx="2.25"
        fill={contentColor}
      />
      <rect
        x="21"
        y="37.5"
        width="4.5"
        height="13.5"
        rx="2.25"
        fill={contentColor}
      />
      <rect
        x="28"
        y="33"
        width="4.5"
        height="18"
        rx="2.25"
        fill={contentColor}
      />

      {/* Security Shield Overlapping Bottom-Right */}
      <path
        d="M46 28L58 32.5V42.5C58 50.8 52.8 57.6 46 60C39.2 57.6 34 50.8 34 42.5V32.5L46 28Z"
        fill={shieldFill}
        stroke={shieldStroke}
        strokeWidth="3"
        strokeLinejoin="round"
      />

      {/* Shield Checkmark */}
      <path
        d="M41.2 44.2L44.6 47.6L51.2 40.5"
        stroke={checkColor}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const Logo: React.FC<LogoProps> = ({
  variant = "full",
  size = "md",
  showTagline = false,
  layout = "stacked",
  iconOnlyOnMobile = false,
  className = "",
}) => {
  const cfg = SIZE_CONFIG[size];

  if (variant === "icon") {
    return (
      <div
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        aria-label="Metadata Checker"
      >
        <LogoMarkSvg sizePx={cfg.iconPx} variant="full" decorative={false} />
      </div>
    );
  }

  const metadataColor =
    variant === "white"
      ? "text-white"
      : variant === "monochrome"
      ? "text-[#0F172A]"
      : "text-[#0F172A]";

  const checkerColor =
    variant === "white"
      ? "text-[#60A5FA]"
      : variant === "monochrome"
      ? "text-[#334155]"
      : "text-[#2563EB]";

  const taglineColor =
    variant === "white"
      ? "text-slate-300"
      : variant === "monochrome"
      ? "text-slate-600"
      : "text-[#64748B]";

  return (
    <div
      className={`inline-flex items-center ${cfg.gap} shrink-0 select-none ${className}`}
      aria-label="Metadata Checker"
    >
      <LogoMarkSvg sizePx={cfg.iconPx} variant={variant} decorative={true} />

      <div
        className={`${
          iconOnlyOnMobile ? "hidden sm:flex" : "flex"
        } flex-col justify-center text-left`}
      >
        {layout === "inline" ? (
          <div className={`font-extrabold tracking-tight whitespace-nowrap ${cfg.inlineText}`}>
            <span className={metadataColor}>METADATA</span>{" "}
            <span className={checkerColor}>CHECKER</span>
          </div>
        ) : (
          <div className={`font-extrabold tracking-tight uppercase ${cfg.titleText}`}>
            <span className={`block ${metadataColor}`}>METADATA</span>
            <span className={`block ${checkerColor}`}>CHECKER</span>
          </div>
        )}

        {showTagline && (
          <span
            className={`font-medium tracking-normal mt-1 leading-snug ${cfg.taglineText} ${taglineColor}`}
          >
            Intelligent PDF &amp; Financial Document Analysis
          </span>
        )}
      </div>
    </div>
  );
};

export default Logo;
