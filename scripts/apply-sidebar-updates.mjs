import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FAVICON_DEFAULT =
  'https://hxumiciyohbianfnzfyk.supabase.co/storage/v1/object/public/arquivos/FAVICON.png';

const SIDEBAR_FILES = [
  'crm.html',
  'conexoes.html',
  'conexoes-apioficial.html',
  'crm-etapas.html',
  'admin.html',
  'disparos-individual.html',
  'agente-ia.html',
  'historico-disparos.html',
  'configuracoes.html',
  'chat.html',
  'agenda.html',
  'disparos-grupos.html',
  'contatos.html',
  'dashboard.html',
  'lista-grupos.html',
  'lista-contatos.html',
  'detalhes-disparo.html',
];

const BRAND_SIDEBAR_VARS = `            /* Menu light: derivado de --brand-500 (trocar só essa variável atualiza o sidebar) */
            --brand-sidebar-bg: color-mix(in srgb, var(--brand-500) 10%, #000000);
            --brand-sidebar-active: color-mix(in srgb, var(--brand-500) 18%, #000000);
            --brand-sidebar-hover: color-mix(in srgb, var(--brand-500) 16%, var(--brand-sidebar-bg));
            --brand-sidebar-divider: color-mix(in srgb, var(--brand-500) 20%, var(--brand-sidebar-bg));
            --brand-sidebar-muted: color-mix(in srgb, var(--brand-500) 45%, #ffffff);`;

const LOGO_CSS = `        .sidebar-logo-img {
            width: 32px;
            height: 32px;
            min-width: 32px;
            object-fit: contain;
            transition: width 0.3s ease, height 0.3s ease, opacity 0.2s ease;
        }

        .sidebar-logo-full {
            display: none;
        }

        .sidebar:hover .sidebar-logo-favicon,
        .sidebar.sidebar-expanded .sidebar-logo-favicon,
        .sidebar.mobile-open .sidebar-logo-favicon {
            display: none;
        }

        .sidebar:hover .sidebar-logo-full,
        .sidebar.sidebar-expanded .sidebar-logo-full,
        .sidebar.mobile-open .sidebar-logo-full {
            display: block;
            width: auto;
            max-width: 100%;
            height: 45px;
            min-width: 0;
        }`;

const LEGACY_LOGO_CSS = `        .sidebar-logo-link {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 40px;
            min-width: 32px;
            flex-shrink: 0;
            margin: 0 auto;
            text-decoration: none;
            transition: width 0.3s ease, min-width 0.3s ease;
        }

        .sidebar:hover .sidebar-logo-link,
        .sidebar.sidebar-expanded .sidebar-logo-link,
        .sidebar.mobile-open .sidebar-logo-link {
            width: 100%;
            min-width: 180px;
            justify-content: center;
            padding: 0 16px;
        }

${LOGO_CSS.split('\n').slice(1).join('\n')}`;

const LIGHT_MODE_SIDEBAR_BLOCK = `        body.light-mode .sidebar {
            background: var(--brand-sidebar-bg);
            border-right: none;
            box-shadow: none;
        }

        body.light-mode .menu-item {
            color: rgba(255, 255, 255, 0.72);
        }

        body.light-mode .menu-item:hover {
            background: var(--brand-sidebar-hover);
            color: #fff;
        }

        body.light-mode .menu-item.active {
            background: var(--brand-sidebar-active);
            color: #fff;
        }`;

function getFaviconUrl(content) {
  const match = content.match(/<link rel="icon"[^>]+href="([^"]+)"/i);
  return match ? match[1] : FAVICON_DEFAULT;
}

function addBrandVars(content) {
  if (content.includes('--brand-sidebar-bg')) return content;

  if (content.includes('--brand-500:')) {
    return content.replace(
      /(--brand-500:\s*#[0-9a-fA-F]{3,8};)/,
      `$1\n${BRAND_SIDEBAR_VARS}`
    );
  }

  if (content.includes(':root {')) {
    return content.replace(
      /(:root\s*\{)/,
      `$1\n            --brand-500: #25d366;\n${BRAND_SIDEBAR_VARS}\n`
    );
  }

  return content.replace(
    /(<style>\s*)/,
    `$1\n        :root {\n            --brand-500: #25d366;\n${BRAND_SIDEBAR_VARS}\n        }\n`
  );
}

function replaceLogoCss(content) {
  const multiLine = /\.sidebar-logo-img\s*\{[\s\S]*?\}\s*\n\s*\.sidebar:hover \.sidebar-logo-img,[\s\S]*?min-width:\s*0;\s*\}/;
  if (multiLine.test(content)) {
    return content.replace(multiLine, LOGO_CSS.trim());
  }

  const oneLine =
    /\.sidebar-logo-img\s*\{[^}]+\}\s*\.sidebar:hover \.sidebar-logo-img[^\{]+\{[^}]+\}/;
  if (oneLine.test(content)) {
    return content.replace(oneLine, LOGO_CSS.trim());
  }

  return content;
}

function replaceLogoMediaQueries(content) {
  return content
    .replace(
      /\.sidebar-logo-img\s*\{\s*width:\s*40px;\s*height:\s*40px;\s*min-width:\s*40px;\s*\}/g,
      '.sidebar-logo-favicon { width: 40px; height: 40px; min-width: 40px; }\n            .sidebar-logo-full { height: 40px; }'
    )
    .replace(
      /\.sidebar-logo-img\s*\{\s*width:\s*36px;\s*height:\s*36px;\s*min-width:\s*36px;\s*\}/g,
      '.sidebar-logo-favicon { width: 36px; height: 36px; min-width: 36px; }\n            .sidebar-logo-full { height: 36px; }'
    )
    .replace(
      /\.sidebar-logo-img\s*\{\s*width:\s*32px;\s*height:\s*32px;\s*min-width:\s*32px;\s*\}/g,
      '.sidebar-logo-favicon { width: 32px; height: 32px; min-width: 32px; }\n            .sidebar-logo-full { height: 32px; }'
    );
}

function replaceThemeToggleHover(content) {
  return content.replace(
    /\.theme-toggle-item:hover\s*\{[^}]*\}/g,
    `.theme-toggle-item:hover {
            background: transparent !important;
            color: rgba(255, 255, 255, 0.72) !important;
        }`
  );
}

function replaceLightModeSidebar(content) {
  let next = content;

  next = next.replace(/body\.light-mode \.sidebar\s*\{[^}]+\}/g, `body.light-mode .sidebar {
            background: var(--brand-sidebar-bg);
            border-right: none;
            box-shadow: none;
        }`);

  next = next.replace(
    /body\.light-mode \.menu-item\s*\{[^}]+\}/g,
    `body.light-mode .menu-item {
            color: rgba(255, 255, 255, 0.72);
        }`
  );

  next = next.replace(
    /body\.light-mode \.menu-item:hover\s*\{[^}]+\}/g,
    `body.light-mode .menu-item:hover {
            background: var(--brand-sidebar-hover);
            color: #fff;
        }`
  );

  next = next.replace(
    /body\.light-mode \.menu-item\.active\s*\{[^}]+\}/g,
    `body.light-mode .menu-item.active {
            background: var(--brand-sidebar-active);
            color: #fff;
        }`
  );

  next = next.replace(
    /body\.light-mode \.version-text\s*\{[^}]+\}/g,
    `body.light-mode .version-text {
            color: var(--brand-sidebar-muted);
        }`
  );

  next = next.replace(
    /body\.light-mode \.sidebar-footer\s*\{[^}]+\}/g,
    `body.light-mode .sidebar-footer {
            border-top: 1px solid var(--brand-sidebar-divider);
        }`
  );

  next = next.replace(
    /body\.light-mode \.sidebar-nav-divider\s*\{[^}]+\}/g,
    `body.light-mode .sidebar-nav-divider {
            background: var(--brand-sidebar-divider);
        }`
  );

  next = next.replace(
    /body\.light-mode \.theme-switch \.slider\s*\{[^}]+\}/g,
    `body.light-mode .theme-switch .slider {
            background-color: color-mix(in srgb, var(--brand-500) 35%, var(--brand-sidebar-bg));
        }`
  );

  return next;
}

function insertLightModeSidebarIfMissing(content) {
  if (content.includes('body.light-mode .sidebar')) return content;

  const marker = '/* Light Mode Styles */';
  if (content.includes(marker)) {
    return content.replace(marker, `${marker}\n${LIGHT_MODE_SIDEBAR_BLOCK}\n`);
  }

  const firstLight = content.indexOf('body.light-mode ');
  if (firstLight === -1) {
    return content.replace(
      '</style>',
      `\n        /* Light Mode Sidebar */\n${LIGHT_MODE_SIDEBAR_BLOCK}\n\n        body.light-mode .version-text {
            color: var(--brand-sidebar-muted);
        }

        body.light-mode .sidebar-footer {
            border-top: 1px solid var(--brand-sidebar-divider);
        }

        body.light-mode .sidebar-nav-divider {
            background: var(--brand-sidebar-divider);
        }

        body.light-mode .theme-switch .slider {
            background-color: color-mix(in srgb, var(--brand-500) 35%, var(--brand-sidebar-bg));
        }
    </style>`
    );
  }

  return (
    content.slice(0, firstLight) +
    `        /* Light Mode Sidebar */\n${LIGHT_MODE_SIDEBAR_BLOCK}\n\n        body.light-mode .version-text {
            color: var(--brand-sidebar-muted);
        }

        body.light-mode .sidebar-footer {
            border-top: 1px solid var(--brand-sidebar-divider);
        }

        body.light-mode .sidebar-nav-divider {
            background: var(--brand-sidebar-divider);
        }

        body.light-mode .theme-switch .slider {
            background-color: color-mix(in srgb, var(--brand-500) 35%, var(--brand-sidebar-bg));
        }

        ` +
    content.slice(firstLight)
  );
}

function replaceSidebarLogoHtml(content, faviconUrl) {
  return content.replace(
    /(<a href="#" class="sidebar-logo-link"[^>]*>\s*)<img class="sidebar-logo-img" src="([^"]+)" alt="([^"]+)" onerror="([^"]+)">/g,
    `$1<img class="sidebar-logo-img sidebar-logo-favicon" src="${faviconUrl}" alt="$3">\n                    <img class="sidebar-logo-img sidebar-logo-full" src="$2" alt="$3" onerror="$4">`
  );
}

function migrateLegacySidebar(content, faviconUrl) {
  if (!content.includes('class="sidebar-logo"') || content.includes('sidebar-logo-favicon')) {
    return content;
  }

  let next = content;

  next = next.replace(
    /\.sidebar-logo\s*\{[^}]+\}\s*\.sidebar-logo img\s*\{[^}]+\}\s*\.sidebar-logo-text\s*\{[^}]+\}\s*\.sidebar:hover \.sidebar-logo[^\{]+\{[^}]+\}/,
    LEGACY_LOGO_CSS.trim()
  );

  next = next.replace(
    /<div class="sidebar-header">\s*<div class="sidebar-logo">\s*<img src="([^"]+)" alt="([^"]+)"[^>]*>\s*<div class="sidebar-logo-text"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
    `<div class="sidebar-header">
                <a href="#" class="sidebar-logo-link" onclick="return false;">
                    <img class="sidebar-logo-img sidebar-logo-favicon" src="${faviconUrl}" alt="$2">
                    <img class="sidebar-logo-img sidebar-logo-full" src="$1" alt="$2" onerror="this.style.display='none';">
                </a>
            </div>`
  );

  next = next.replace(
    /document\.querySelector\('\.sidebar-logo'\)/g,
    "document.querySelector('.sidebar-logo-full')"
  );

  next = next.replace(
    /\.sidebar-logo,\s*\.sidebar-logo img/g,
    '.sidebar-logo-favicon, .sidebar-logo-full'
  );

  return next;
}

function patchAdminLogoSelector(content) {
  return content.replace(
    /document\.querySelector\('#sidebar \.sidebar-logo-img'\)/g,
    "document.querySelector('#sidebar .sidebar-logo-full')"
  );
}

function processFile(filename) {
  const filePath = path.join(ROOT, filename);
  let content = fs.readFileSync(filePath, 'utf8');
  const faviconUrl = getFaviconUrl(content);

  content = addBrandVars(content);
  content = replaceLogoCss(content);
  content = replaceLogoMediaQueries(content);
  content = replaceThemeToggleHover(content);
  content = insertLightModeSidebarIfMissing(content);
  content = replaceLightModeSidebar(content);
  content = replaceSidebarLogoHtml(content, faviconUrl);
  content = migrateLegacySidebar(content, faviconUrl);
  content = patchAdminLogoSelector(content);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${filename}`);
}

for (const file of SIDEBAR_FILES) {
  processFile(file);
}
