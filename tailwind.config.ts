import type { Config } from 'tailwindcss'
//hsl(var(--color-bkg) / <alpha-value>)
const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/configs/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // safelist moved to `@source inline(...)` in src/styles/tailwind-entry.css:
  // Tailwind v4's Config type dropped `safelist` (see HTPR-3960).
  darkMode:"class",
  theme: {
    
    extend: {
      ringColor:{
        "container-outline":"var(--focus-ring)",
      },
      overflow:{
        "unset":"unset"
      },
      maxHeight:{
        "default-modal":"300px",
        "inherit":"inherit"
      },
      height:{
        'labelComponent':"22px",
        "SVH-full":"100svh",
      },
      colors: {
        "pageBackground":"var(--color-page-background)",
        "hypertasks-green":"#C2CFA5",
        "hypertasks-purple":"#4455BB",
        "hypertasks-header-blue":"rgb(35, 131, 226)",
        'icon-dark-gray': '#999a9d',
        'icon-hover-gray':"#95999e",
        "header-text":"#76777a",
        "header-icon":"#ffffff",
        "header-hover-text":"#95999e",
        "dark-background":"#0E0E0E",
        "white-black":"var(--color-white-black)",
        "text-light-gray":"var(--color-text-light-gray)",
        "white-black-inverted":"var(--color-white-black-inverted)",
        hoverCardBackground:"var(--hover-cardBackground)",       
        "selected-item-border":"var(--border-active)",
         "comment-description-border":"var(--color-border-comment-description)",
        "my-comment":"var(--color-my-comment)",
        "light-black-border":{
          "1":"rgb(0,0,0,0.10)",
          "4":"rgb(0,0,0,0.40)",
        },
        "hypertasks-ai-purple":"#C668FF",
        "label-component":"var(--color-text-labelComponent)",
        'shadcn-primary': 'hsl(var(--shadcn-primary)) ',
        'primary-foreground': 'hsl(var(--primary-foreground))',
        'secondary': 'hsl(var(--secondary)) ',
        'secondary-foreground': 'hsl(var(--secondary-foreground))',
        'text-muted': 'hsl(var(--muted)) !important',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        'accent': 'hsl(var(--accent)) !important',
        'accent-foreground': 'hsl(var(--accent-foreground)) !important',
        'destructive': 'hsl(var(--destructive))',
        'destructive-foreground': 'hsl(var(--destructive-foreground))',
        'border': 'hsl(var(--border))',
        'input': 'hsl(var(--input))',
        'ring': 'hsl(var(--ring))',
        "button-arrow-disabled":"var(--button-arrow-disabled)",
        "button-arrow":"var(--button-arrow)",
        "kanban-column-scrollbar":"var(--color-kanban-column-scrollbar)",
        "selectionLight": '#d3d3d3', // Light grey for light theme
        'selectionDark': '#555555',  // Dark grey for dark theme
        'light-white': 'rgba(255, 255, 255, 0.8)', // White with 80% opacity
        "mention-highlight":"var(--color-mention-highlight)",
        "pull-request-open":"var(--color-pull-request-open)",
        "pull-request-checks-red":"var(--color-pull-request-checks-red)",
        "pull-request-green":"var(--color-pull-request-green)",
        "pull-request-merged":"var(--color-pull-request-merged)",
      },
      width:{
        "new-notification":"7px",
      },
      borderWidth:{
        "thin":"1px",
      },
      borderColor:{
        "borderGray":"hsl(var(--color-border));",
        "border-labelComponent":"#6f6f6f",
        "border-self-comment":"rgb(var(--border-self-comment))",
        "border-light-gray-thin":"var(--border-light-gray-thin)",
        "border-active-modal-element":"var(--active-modal-element)",
      },
      backgroundColor:{
        pageBackground:"var(--bg-pageBackground)",
        "back-button":"var(--bg-back-button)",
        containerBackground:"var(--bg-containerBackground)",
        "containerBackground-inverted":"var(--bg-containerBackground-inverted)",
        cardBackground:"var(--bg-cardBackground)",
        "kanban-active-cardbg":"var(--active-kanbanCardbg)",
        modalBackground:"var(--bg-modalBackground)",
        "hover-active":"var(--bg-hover-active)",
        "comment-description":"var(--bg-comment-description)",
        "newcomment-well":"var(--bg-newcomment-well)",
        "ai-tiptap": "var(--bg-ai-chat-tiptap)",
        "ai-chat": "var(--bg-ai-chat)",
        "taskDetailPage":"var(--bg-taskDetailPage)",
        "label-span":"var(--bg-label-span)",
        "taskDetal-container":"var(--bg-taskDetail-container) !important",
        "tooltip":"var(--bg-tooltip)",
        "active-elementBg":"var(--active-elementBg)",
        "newComment-container":"var(--bg-newComment-container)",
        "active-modal-element":"var(--active-modal-element)",
        "active-list-element":"var(--active-list-element)",
        "task-tag":"var(--bg-task-tag)",
        "sidebar":"var(--bg-sidebar)",
        "labelComponent":"#D9D9D9",
        "self-comment":"var(--bg-self-comment)",
        "mentionList":"var(--bg-mention) !important",
        "active":{
          "mentionList":"var(--active-mentionList)"
        },
        "reactions":{
          "others":"var(--bg-reactions)",
        },
        "mention-highlight":"var(--bg-mention-highlight)",
        
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'gradient-dark': 'linear-gradient(to bottom, #000000, #0a0012, #11001b)',
      },
      fontFamily:{
        // Inter is the fallback `font-sans` value for surfaces without a theme
        // override. Core themes replace it with IBM Plex Sans, while Dia headings
        // use Newsreader. Keep this explicit so `font-sans` labels do not fall back
        // to a platform-dependent system stack. `mono` and `serif` keep Tailwind's
        // defaults.
        sans:[
          "var(--font-inter)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      fontSize:{
        "modalSmall":"16px",
        // HTPR-4215 typography scale — the only 8 sizes the app uses
        "micro":"11px",
        "meta":"12px",
        "dense":"13px",
        // "content" not "body": Bootstrap ships .text-body{color:...!important} which hijacks text color
        "content":"14px",
        "emphasis":"16px",
        "subheading":"18px",
        "heading":"24px",
        "display":"32px",
      },
      boxShadow:{
        "customshadow-4":"12px 12px 80px 0px rgb(0, 0, 0);",
        "customshadow-2":"2px 2px 20px 0px rgb(0, 0, 0, 0.35);",
        "customshadow-1":"2px 2px 20px 0px rgb(0, 0, 0, 0.15);",

      },
      backgroundSize: {
        'size-200': '200% 200%',

      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        gradient: {
          "0%, 100%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        'gradient': 'gradient 3s ease infinite',
        "fade-in": "fadeIn 0.5s ease-in-out forwards",

      },
      padding:{
        "inbox-horizontal":"0px 12px",
      },
      /** Align @tailwindcss/container-queries names with `screens` so @sm/@md/@lg/@xl mean the same min-widths as viewport breakpoints, but for the nearest `@container` ancestor. */
      containers: {
        xs: "280px",
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1300px",
        "2xl": "1536px",
        "3xl": "48rem",
        "4xl": "56rem",
        "5xl": "64rem",
        "6xl": "72rem",
        "7xl": "80rem",
      },
     
    },
    screens: {
      'xs': '280px',
      "x-sm":"400px",
      'sm': '640px',
      // => @media (min-width: 640px) { ... }

      'md': '768px',
      // => @media (min-width: 768px) { ... }

      'lg': '1024px',
      // => @media (min-width: 1024px) { ... }

      'xl': '1300px',
      // => @media (min-width: 1280px) { ... }

      '2xl': '1536px',
      // => @media (min-width: 1536px) { ... }

      '3xl': '1920px',
      // => @media (min-width: 1920px) { ... }
    }
    
  
  },
  plugins: [
    // @tailwindcss/container-queries removed: Tailwind v4 has native container queries
    // (sizes overridden in src/styles/tailwind-entry.css to match the old plugin config)
    require("tailwind-scrollbar"),
  ],
}
export default config
