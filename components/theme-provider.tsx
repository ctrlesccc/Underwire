"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

// Derive props from the actual component type (works across versions)
type Props = React.ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({ children, ...props }: Props) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
