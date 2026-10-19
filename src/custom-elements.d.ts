import type React from 'react';
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'm3e-theme': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { color?: string; scheme?: string; variant?: string; motion?: string };
      'm3e-icon': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { name?: string; filled?: boolean; variant?: string };
      'm3e-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { variant?: string; href?: string; target?: string; disabled?: boolean; type?: string };
      'm3e-icon-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { toggle?: boolean; selected?: boolean; title?: string; disabled?: boolean; variant?: string };
      'm3e-card': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { variant?: string; orientation?: string };
      'm3e-expansion-panel': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { open?: boolean; disabled?: boolean; 'toggle-position'?: string };
      'm3e-dialog': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { open?: boolean; dismissible?: boolean; 'close-label'?: string };
      'm3e-search-bar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { clearable?: boolean };
      'm3e-divider': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-chip': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { variant?: string; selected?: boolean };
      'm3e-switch': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { checked?: boolean };
      'm3e-tabs': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-tab': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { selected?: boolean };
      'm3e-progress-indicator': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { indeterminate?: boolean };
      'm3e-skeleton': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-textarea-autosize': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-app-bar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-nav-menu': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-nav-bar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { mode?: string };
      'm3e-nav-rail': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { mode?: string };
      'm3e-nav-item': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { selected?: boolean; disabled?: boolean; href?: string; orientation?: string };
      'm3e-split-pane': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { orientation?: string; value?: number; min?: number; max?: number; disabled?: boolean };
      'm3e-content-pane': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-toolbar': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { variant?: string; shape?: string; elevated?: boolean; vertical?: boolean };
      'm3e-slide-group': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { threshold?: number; vertical?: boolean; disabled?: boolean; 'next-page-label'?: string; 'previous-page-label'?: string };
      'm3e-nav-menu-item': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { selected?: boolean; disabled?: boolean };
      'm3e-list': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-list-item': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
      'm3e-list-item-button': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { selected?: boolean; disabled?: boolean };
    }
  }
}
export {};
