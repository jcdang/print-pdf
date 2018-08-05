import * as JsPDF from 'jspdf';

export interface IPrintConfig {
  document?: Document;
  window?: Window;
}
export interface ISrcDstPair {
  src: HTMLElement;
  dst: HTMLElement;
}

function getBinaryPromise(url: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.overrideMimeType('text/plain; charset=x-user-defined');
    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          resolve(xhr.responseText);
        } else {
          // reject(xhr.status);
          resolve('');
        }
      }
    };
    xhr.send();
  });
}

function base64Encode(str: string) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = str.length;
  const out = [];
  let i = 0;
  let c1;
  let c2;
  let c3;
  while (i < len) {
    c1 = str.charCodeAt(i++) & 0xff;
    if (i === len) {
      out.push(CHARS.charAt(c1 >> 2));
      out.push(CHARS.charAt((c1 & 0x3) << 4));
      out.push('==');
      break;
    }
    c2 = str.charCodeAt(i++);
    if (i === len) {
      out.push(CHARS.charAt(c1 >> 2));
      out.push(CHARS.charAt(((c1 & 0x3) << 4) | ((c2 & 0xF0) >> 4)));
      out.push(CHARS.charAt((c2 & 0xF) << 2));
      out.push('=');
      break;
    }
    c3 = str.charCodeAt(i++);
    out.push(CHARS.charAt(c1 >> 2));
    out.push(CHARS.charAt(((c1 & 0x3) << 4) | ((c2 & 0xF0) >> 4)));
    out.push(CHARS.charAt(((c2 & 0xF) << 2) | ((c3 & 0xC0) >> 6)));
    out.push(CHARS.charAt(c3 & 0x3F));
  }

  return out.join('');
}

export class PrintPDF {
  private static readonly PSEUDO_ELEMENTS: string[] = [
    '::after',
    '::before'
    // '::placeholder'
  ];

  private static readonly IGNORED_PROPERTIES: Set<string> = new Set<string>([
    'animation',
    'animation-delay',
    'animation-direction',
    'animation-duration',
    'animation-fill-mode',
    'animation-iteration',
    'animation-name',
    'animation-play-state: ',
    'animation-timing-function',
    'animation-iteration-count',
    'animation-play-state',
    'transition-delay',
    'transition-duration',
    'transition-property',
    'transition-timing-function',
    'cursor'
  ]);

  private static readonly MIME_TYPES: {} = {
    woff: 'application/font-woff',
    woff2: 'application/font-woff',
    eot: 'application/vnd.ms-fontobject',
    ttf: 'application/font-sfnt',
    svg: 'image/svg+xml'

  };

  private static getMimeType(url: string) {
    const match = /\.([A-z0-9]+?)([?#]+.*)?$/gi.exec(url);
    if (!match) {
      return 'text/html';
    }

    return PrintPDF.MIME_TYPES[match[1].toLowerCase()];
  }

  private static zip<T>(...args: T[][]) {
    return args[0].map(({}: {}, i: number) => args.map((array: T[]) => array[i]));
  }

  private static flatMap<T, E>(elements: T[], callback: (t: T) => E[]): E[] {
    return elements.reduce((ys: E[], x: T) => {
      return ys.concat(callback.call(this, x));
    },                     [] as E[]);
  }

  private serializer: XMLSerializer;
  private doc: Document;
  private win: Window;
  private readonly element: HTMLElement;
  private uniqueCounter: number;
  private defaultsMap: Map<string, Map<string, {}>>;

  constructor(element: HTMLElement, cfg: IPrintConfig = {}) {
    this.serializer = new XMLSerializer();
    this.doc = cfg.document || document;
    this.win = cfg.window || window;
    this.element = element;
    this.uniqueCounter = 0;
    this.defaultsMap = new Map<string, Map<string, {}>>();
  }

  public getDefaultMap(tagName: string): Map<string, {}> {
    if (this.defaultsMap.has(tagName)) {
      return this.defaultsMap.get(tagName);
    }
    const el = this.doc.createElement(tagName);
    const elMap = new Map<string, {}>();
    this.doc.body.appendChild(el);
    const computedStyles = this.win.getComputedStyle(el);
    Array.from(computedStyles).forEach(prop => {
      elMap.set(prop, computedStyles.getPropertyValue(prop));
    });
    el.remove();
    this.defaultsMap.set(tagName, elMap);

    return elMap;
  }

  public getUniqueClassName(): string {
    this.uniqueCounter += 1;

    return `print-pdf-cn-${this.uniqueCounter}`;
  }

  public traverseNodes(o: HTMLElement, d: HTMLElement, applyFn: (n1: HTMLElement, n2: HTMLElement) => void) {
    const { filter } = Array.prototype;

    applyFn(o, d);
    if (o && d) {
      const srcNodes = filter.call(o.childNodes, (e: {}) => e instanceof HTMLElement);
      const dstNodes = filter.call(d.childNodes, (e: {}) => e instanceof HTMLElement);
      if (srcNodes && dstNodes && srcNodes.length === dstNodes.length) {
        PrintPDF.zip(srcNodes, dstNodes).forEach((v: [HTMLElement, HTMLElement]) =>
          this.traverseNodes(v[0], v[1], applyFn)
        );
      }
    }
  }

  public copyFontFaces(globalStyle: HTMLStyleElement, progressFn: (percent: number, status: string) => void) {
    return new Promise<{}>(resolve => {
      const styleSheets = Array.from(this.doc.styleSheets);
      const cssRules = PrintPDF.flatMap(styleSheets, (s: CSSStyleSheet) => Array.from(s.cssRules));
      const ruleType = CSSRule.FONT_FACE_RULE;
      const ffRules: CSSRule[] = cssRules.filter((r: CSSRule) => r.type === ruleType);

      interface KV {
        key: string;
        value: string;
      }
      const promises: Promise<KV>[] = [];
      let counter = 0;

      ffRules.forEach((r: CSSStyleRule) => {
        const styleProperties = Array.from(r.style);
        styleProperties.forEach((property: string) => {
          const propValue = r.style.getPropertyValue(property);
          const reg = new RegExp(/url\(["']?(.+?)["']?\)/g);
          let exec = reg.exec(propValue);
          while (exec) {
            const match = exec[1];
            const baseUrl = r.parentStyleSheet.href || this.element.ownerDocument.location.href;
            const url = new URL(match, baseUrl).toString();
            const mimeType = PrintPDF.getMimeType(url);
            const promChain = getBinaryPromise(url).then(base64Encode).then(enc => {
                counter++;
                const percent = (counter / promises.length * .20);
                const status = `Loading Font Asset ${counter}/${promises.length}`;
                progressFn(percent, status);

                return { key: url, value: `url("data:${mimeType};base64,${enc}")` };
              }
            );
            promises.push(promChain);
            exec = reg.exec(propValue);
          }
        });
      });

      return Promise.all(promises).then(kvList => {
        const mapResults = new Map<string, string>();
        kvList.forEach(kv => {
          mapResults.set(kv.key, kv.value);
        });

        return mapResults;
      }).then(mapResults => {
        ffRules.forEach((r: CSSStyleRule) => {
          const styleProperties = Array.from(r.style);
          const styleText = styleProperties.map((property: string) => {
            let propValue = r.style.getPropertyValue(property);
            if (/url\(["']?[^)]+["']?\)/.test(propValue)) {
              const baseUrl = r.parentStyleSheet.href || this.element.ownerDocument.location.href;
              propValue = propValue.replace(/url\(["']?(.+?)["']?\)/g, (__: string, match: string) => {
                const url = new URL(match, baseUrl).toString();
                if (mapResults.has(url)) {
                  return mapResults.get(url);
                }
                // Shouldn't happen if we're able to load

                return `url("${match}")`;
              });
            }

            return `\t${property}: ${propValue};`;
          }).join('\n');
          const textNode = this.doc.createTextNode(`\n@font-face {\n${styleText}\n}\n`);
          globalStyle.appendChild(textNode);
          resolve();
        });
      });
    });
  }

  public getCSSText(computedStyle: CSSStyleDeclaration, dst: HTMLElement, selector: string = '') {
    const { filter } = Array.prototype;
    const defaultMap = this.getDefaultMap(dst.tagName);
    const textPairs = [];

    filter.call(computedStyle, (name: string) => !PrintPDF.IGNORED_PROPERTIES.has(name))
      .forEach((propertyName: string) => {
        const propValue = computedStyle.getPropertyValue(propertyName);
        if (selector !== '' || defaultMap.get(propertyName) !== propValue) {
          textPairs.push(`\t${propertyName}: ${propValue} !important;`);
        }
      });
    const cssText = textPairs.join('\n');
    if (dst.className.length === 0) {
      dst.className = this.getUniqueClassName();
    }
    const className = dst.className;

    return `\n.${className}${selector} {\n${cssText}\n}\n`;
  }

  public toPDF(progressFn: (percentComplete: number, statusMsg: string) => void = () => { return; }): Promise<JsPDF> {
    const element = this.element;
    let copyElement;
    const ceComputedStyle = this.win.getComputedStyle(element);
    let width = element.clientWidth;
    let height = element.clientHeight;
    width += parseInt(ceComputedStyle.getPropertyValue('margin-left'), 10);
    width += parseInt(ceComputedStyle.getPropertyValue('margin-right'), 10);
    height += parseInt(ceComputedStyle.getPropertyValue('margin-top'), 10);
    height += parseInt(ceComputedStyle.getPropertyValue('margin-bottom'), 10);
    const globalStyle = this.doc.createElement('style');
    globalStyle.type = 'text/css';
    const srcDstPairs: ISrcDstPair[] = [];
    const copiedStyles = [];

    return new Promise(resolve => {
      this.win.setTimeout(() => {
        progressFn(0.0, 'Cloning Node');
        copyElement = this.doc.importNode(element, true) as HTMLElement;
        copyElement.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
        resolve();
      },                  100);
    }).then(() => {
      return this.copyFontFaces(globalStyle, progressFn);
    }).then(() => {
      let counter = 0;
      const copySubTaskPercent = .6;
      const nodePromises = [];
      this.traverseNodes(element, copyElement, (src: HTMLElement, dst: HTMLElement) => {
        nodePromises.push(new Promise(resolve => {
          this.win.setTimeout(() => {
            counter++;
            srcDstPairs.push({ src, dst });
            dst.className = '';
            dst.removeAttribute('style');
            const computedStyle = this.win.getComputedStyle(src);
            const text = this.getCSSText(computedStyle, dst);
            copiedStyles.push(text);
            PrintPDF.PSEUDO_ELEMENTS.forEach((pseudoSelector: string) => {
              const psComputedStyle = this.win.getComputedStyle(src, pseudoSelector);
              const content = psComputedStyle.getPropertyValue('content');
              if (content !== 'none') {
                const psText = this.getCSSText(psComputedStyle, dst, pseudoSelector);
                copiedStyles.push(psText);
              }
            });
            const statusMsg = `Reading Computed Style ${counter}/${nodePromises.length}`;
            const percentComplete = (counter / nodePromises.length * copySubTaskPercent) + .2;
            progressFn(percentComplete, statusMsg);
            resolve();
          },                  counter * 100);
        }));
      });

      return Promise.all(nodePromises);
    }).then(() => {
      this.defaultsMap.forEach((innerMap, tagName) => {
        const textPairs = [];
        innerMap.forEach((propValue, propertyName) => {
          textPairs.push(`\t${propertyName}: ${propValue};`);
        });
        const styleText = `\n.print-cn-${tagName} {\n${textPairs.join('\n')}\n}\n`;
        copiedStyles.push(styleText);
      });

      // Adding the default styling based on tag name
      this.traverseNodes(element, copyElement, (__: HTMLElement, dst: HTMLElement) => {
        dst.className = `print-cn-${dst.tagName} ${dst.className}`;
      });
      const stylesText = copiedStyles.join('');
      const textNode = this.doc.createTextNode(stylesText);
      globalStyle.appendChild(textNode);
      const promises = srcDstPairs.map((pair: ISrcDstPair) => {
        const { src, dst } = pair;

        return new Promise((resolve) => {
          ['scrollLeft', 'scrollTop', 'value'].forEach((prop: string) => {
            dst[prop] = src[prop];
          });
          resolve();
        });
      });

      return Promise.all(promises);
    }).then(() => {
      progressFn(.80, 'Appending Master StyleSheet');
      copyElement.appendChild(globalStyle);

      return copyElement;
    }).then(copy => {
      progressFn(.83, 'Serializing');

      return this.serializer.serializeToString(copy);
    }).then(serialized => {
      progressFn(.84, 'Encoding to Data URI');
      const encoded = encodeURIComponent(serialized);
      const foreignObject = `<foreignObject width='100%' height='100%'>${encoded}</foreignObject>`;
      const namespace = 'http://www.w3.org/2000/svg';
      const svgMarkup = `<svg xmlns='${namespace}' width='${width}' height='${height}'>${foreignObject}</svg>`;

      return `data:image/svg+xml,${svgMarkup}`;
    }).then(dataUri => {

      return new Promise(resolve => {
        this.win.setTimeout(() => {
          progressFn(.85, 'Creating Canvas');
          const tmpCanvas = this.doc.createElement('canvas');
          tmpCanvas.width = width;
          tmpCanvas.height = height;
          const tmpCtx = tmpCanvas.getContext('2d', { alpha: false });
          tmpCtx.fillStyle = '#ffffff';
          tmpCtx.fillRect(0, 0, width, height);
          const img = new Image();
          img.onload = () =>  {
            progressFn(.90, 'Drawing');
            tmpCtx.drawImage(img, 0, 0, width, height);
            const dataURL = tmpCanvas.toDataURL('image/jpeg', 1.0);
            resolve(dataURL);
          };
          img.src = dataUri;
        },                  10);
      });

    }).then(dataURL => {
      progressFn(.95, 'Creating PDF');
      const orientation = (width > height) ? 'l' : 'p';
      const pdf = new JsPDF(orientation, 'pt', [width, height]);
      const w = Math.floor(pdf.internal.pageSize.getWidth());
      const h = Math.floor(pdf.internal.pageSize.getHeight());
      pdf.addImage(dataURL, 'PNG', 0, 0, w, h);
      progressFn(1.0, 'Done');

      return pdf;
    });
  }

  public printPDF(progressFn?: (percentComplete: number, statusMsg: string) => void): Promise<JsPDF> {
    return this.toPDF(progressFn).then((pdf: JsPDF) => {
      const fileURL = URL.createObjectURL(pdf.output('blob'));
      const win = window.open(fileURL, '_blank');
      win.focus();

      return pdf;
    });
  }
}
