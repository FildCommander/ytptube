import type { convert_args_response } from "~/types/responses";

const runtimeConfig = useRuntimeConfig()
const toast = useNotification()

const AG_SEPARATOR = '.'

const separators = [
  { name: 'Comma', value: ',', },
  { name: 'Semicolon', value: ';', },
  { name: 'Colon', value: ':', },
  { name: 'Pipe', value: '|', },
  { name: 'Space', value: ' ', }
]

/**
 * Get value from object or function.
 *
 * @param obj - A function or value.
 * @returns The result of calling the function if it's a function, otherwise the value.
 */
const getValue = <T>(obj: (() => T) | T): T => {
  return 'function' === typeof obj ? (obj as () => T)() : obj
}

/**
 * Safely get a value from a nested object using a path string. Returns default value if not found.
 *
 * @param obj - The object to get the value from.
 * @param path - Dot-delimited string path (e.g. 'a.b.c').
 * @param defaultValue - The fallback value if path is not found or value is null/undefined.
 * @returns The value at the path or the default value.
 */
const ag = <T = any>(obj: any, path: string, defaultValue: T | null = null): T | null => {
  const keys = path.split(AG_SEPARATOR)
  let at = obj

  for (const key of keys) {
    if ('object' === typeof at && null !== at && key in at) {
      at = at[key]
    } else {
      return getValue(defaultValue)
    }
  }

  return getValue(null === at ? defaultValue : at)
}

/**
 * Set a value in a nested object using a dot-delimited path.
 *
 * @param obj - The object to modify.
 * @param path - Dot-delimited string path (e.g. 'a.b.c').
 * @param value - The value to set.
 * @returns The original object with the updated value.
 * @throws Error if a path segment is not an object.
 */
const ag_set = (obj: Record<string, any>, path: string, value: any): Record<string, any> => {
  const keys = path.split(AG_SEPARATOR)
  let at: any = obj

  while (keys.length > 0) {
    if (1 === keys.length) {
      if ('object' === typeof at && null !== at) {
        at[keys.shift()!] = value
      } else {
        throw new Error(`Cannot set value at this path (${path}) because it's not an object.`)
      }
    } else {
      const key = keys.shift()!
      if (!at[key] || 'object' !== typeof at[key]) {
        at[key] = {}
      }
      at = at[key]
    }
  }

  return obj
}

/**
 * Wait for an element to appear in the DOM, then invoke a callback.
 *
 * @param sel - CSS selector for the target element.
 * @param callback - Function to execute when the element is found.
 */
const awaitElement = (sel: string, callback: (el: Element, selector: string) => void): void => {
  const $elm = document.querySelector(sel)
  if ($elm) {
    callback($elm, sel)
    return
  }

  const interval = setInterval(() => {
    const $elm = document.querySelector(sel)
    if ($elm) {
      clearInterval(interval)
      callback($elm, sel)
    }
  }, 200)
}

/**
 * Replace template tags in a string with values from a context object.
 *
 * @param text - The input string containing tags in `{key}` format.
 * @param context - An object whose keys are used for tag replacement.
 * @returns The string with all matching tags replaced.
 */
const r = (text: string, context: Record<string, any> = {}): string => {
  const tagLeft = '{'
  const tagRight = '}'

  if (!text.includes(tagLeft) || !text.includes(tagRight)) {
    return text
  }

  const pattern = new RegExp(`${tagLeft}([\\w_.]+)${tagRight}`, 'g')
  const matches = text.match(pattern)
  if (!matches) return text

  const replacements: Record<string, string> = {}
  matches.forEach(match => {
    const key = match.slice(1, -1)
    replacements[match] = String(ag(context, key, ''))
  })

  for (const key in replacements) {
    text = text.replace(new RegExp(key, 'g'), String(replacements[key]))
  }

  return text
}

/**
 * Dispatch a custom event on the global window object.
 *
 * @param eventName - The name of the custom event.
 * @param detail - Optional detail payload to include in the event.
 * @returns Whether the event was successfully dispatched.
 */
const dEvent = (eventName: string, detail: Record<string, any> = {}): boolean => {
  return window.dispatchEvent(new CustomEvent(eventName, { detail }))
}

/**
 * Generate a pagination list based on current page, total pages, and delta range.
 *
 * @param current - The current active page number.
 * @param last - The last page number.
 * @param delta - How many pages to show before/after the current page.
 * @returns An array of pagination entries including optional gaps.
 */
const makePagination = (current: number, last: number, delta: number = 5): Array<{ page: number; text: string; selected: boolean }> => {
  const pagination: Array<{ page: number; text: string; selected: boolean }> = []
  if (last < 2) {
    return pagination
  }

  const strR = '-'.repeat(9 + `${last}`.length)
  const left = current - delta
  const right = current + delta + 1

  for (let i = 1; i <= last; i++) {
    if (1 === i || last === i || (i >= left && i < right)) {
      if (i === left && i > 2) {
        pagination.push({ page: 0, text: strR, selected: false })
      }

      pagination.push({ page: i, text: `Page #${i}`, selected: i === current })

      if (i === right - 1 && i < last - 1) {
        pagination.push({ page: 0, text: strR, selected: false })
      }
    }
  }

  return pagination
}

/**
 * Safely encode a path string for use in a URL.
 * Will manually encode '#' and ensure valid URI segments.
 *
 * @param item - The input path string.
 * @returns The URL-encoded path.
 */
const encodePath = (item: string): string => {
  if (!item) {
    return item
  }

  item = item.replace(/#/g, '%23')

  try {
    return item.split('/').map(decodeURIComponent).map(encodeURIComponent).join('/')
  } catch (e) {
    console.error('Error encoding path:', e, item)
    return item
  }
}

/**
 * Request content from the API with automatic token handling and URL prefixing.
 *
 * @param url - The URL to request. If relative, it will be passed through the `uri` helper.
 * @param options - Optional fetch options, automatically extended with common headers and credentials.
 * @returns The fetch Response promise.
 */
const request = (url: string, options: RequestInit = {}): Promise<Response> => {
  options.method = options.method || 'GET'
  options.headers = options.headers || {}; (options as any).withCredentials = true

  if (undefined === (options.headers as Record<string, any>)['Content-Type']) {
    if (!(options?.body instanceof FormData)) {
      ; (options.headers as Record<string, any>)['Content-Type'] = 'application/json'
    }
  }

  if (undefined === (options.headers as Record<string, any>)['Accept']) {
    ; (options.headers as Record<string, any>)['Accept'] = 'application/json'
  }

  if (url.startsWith('/')) {
    options.credentials = 'same-origin'
  }

  return fetch(url.startsWith('/') ? uri(url) : url, options)
}

/**
 * Remove ANSI color codes from a string.
 *
 * @param text - The text potentially containing ANSI codes.
 * @returns A string without ANSI escape sequences.
 */
const removeANSIColors = (text: string): string => {
  return text?.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '') ?? text
}

/**
 * Convert a decimal value to a 2-character hex string.
 *
 * @param dec - Decimal value between 0-255.
 * @returns The hex string.
 */
const dec2hex = (dec: number): string => dec.toString(16).padStart(2, '0')

/**
 * Generate a random ID using crypto.
 *
 * @param len - The length of the ID in characters (must be even).
 * @returns A random hex ID string.
 */
const makeId = (len: number = 40): string => Array.from(window.crypto.getRandomValues(new Uint8Array(len / 2)), dec2hex).join('')

/**
 * Return the basename of a given path.
 *
 * @param path - The input path.
 * @param ext - Optional extension to strip from the basename.
 * @returns The last segment of the path, minus the extension if matched.
 */
const basename = (path: string, ext: string = ''): string => {
  if (!path) return ''
  const segments = path.replace(/\\/g, '/').split('/')
  let base = segments.pop() || ''
  while (segments.length && base === '') {
    base = segments.pop() || ''
  }
  if (ext && base.endsWith(ext) && base !== ext) {
    base = base.substring(0, base.length - ext.length)
  }
  return base
}

/**
 * Return the directory portion of a path.
 *
 * @param filePath - The input file path.
 * @returns The directory part of the path.
 */
const dirname = (filePath: string): string => {
  const lastIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  if (-1 === lastIndex) {
    return '.'
  }

  if (0 === lastIndex) {
    return filePath[0] ?? '.'
  }

  return filePath.substring(0, lastIndex)
}

/**
 * Copy text to clipboard with optional notification and storage flag.
 *
 * @param str - The string to copy.
 * @param notify - Whether to show a toast notification (default: true).
 * @param store - Whether to persist the notification (optional).
 */
const copyText = (str: string, notify: boolean = true, store: boolean = false): void => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(str).then(() => {
      if (notify) toast.success('Text copied to clipboard.')
    }).catch((error) => {
      console.error('Failed to copy.', error)
      if (notify) toast.error('Failed to copy to clipboard.')
    })
    return
  }

  const el = document.createElement('textarea')
  el.value = str
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)

  if (notify) {
    toast.success('Text copied to clipboard.', { store })
  }
}

/**
 * Trim delimiter characters from a string at specified positions.
 *
 * @param str - The input string to trim.
 * @param delim - The delimiter character to trim.
 * @param position - Where to trim the delimiter from: 'start', 'end', or 'both'. Defaults to 'both'.
 * @returns The trimmed string.
 * @throws Will throw an error if `delim` is not provided.
 */
const iTrim = (str: string, delim: string, position: 'start' | 'end' | 'both' = 'both'): string => {
  if (!str) {
    return str
  }

  if (!delim) {
    throw new Error('Delimiter is required')
  }

  if (']' === delim) {
    delim = '\\]'
  }

  if ('\\' === delim) {
    delim = '\\\\'
  }

  if (['both', 'start'].includes(position)) {
    str = str.replace(new RegExp(`^[${delim}]+`, 'g'), '')
  }

  if (['both', 'end'].includes(position)) {
    str = str.replace(new RegExp(`[${delim}]+$`, 'g'), '')
  }

  return str
}

/**
 * Trim delimiter characters from the end of a string.
 *
 * @param str - The input string to trim.
 * @param delim - The delimiter character to trim.
 * @returns The trimmed string.
 */
const eTrim = (str: string, delim: string): string => iTrim(str, delim, 'end')

/**
 * Trim delimiter characters from the start of a string.
 *
 * @param str - The input string to trim.
 * @param delim - The delimiter character to trim.
 * @returns The trimmed string.
 */
const sTrim = (str: string, delim: string): string => iTrim(str, delim, 'start')

/**
 * Uppercase the first character of the string.
 *
 * @param str - The input string.
 * @returns The string with the first character capitalized.
 */
const ucFirst = (str: string): string => (!str) ? str : str.charAt(0).toUpperCase() + str.slice(1)

/**
 * Get the name of a separator based on its value
 *
 * @param {string} value - The separator value
 *
 * @returns {string} The name of the separator, or 'Unknown' if not found
 */
const getSeparatorsName = (value: string): string => {
  const sep = separators.find(s => s.value === value)
  return sep ? `${sep.name} (${value})` : 'Unknown'
}

/**
 * Convert options to JSON
 *
 * @param {string} opts
 *
 * @returns {Promise<convert_args_response>} The converted options
 */
const convertCliOptions = async (opts: string): Promise<convert_args_response> => {
  const response = await request('/api/yt-dlp/convert', {
    method: 'POST',
    body: JSON.stringify({ args: opts }),
  });

  const data = await response.json()
  if (200 !== response.status) {
    throw new Error(`Error: (${response.status}): ${data.error}`)
  }

  return data
}

/**
 * Get query parameters from a URL string or the current location.
 *
 * @param url - The full URL or search string (default: current URL's search).
 * @returns A key-value map of query parameters.
 */
const getQueryParams = (url: string = window.location.search): Record<string, string> => {
  return Object.fromEntries(new URLSearchParams(url).entries())
}

/**
 * Build a download URL based on config and item metadata.
 *
 * @param config - The application config object.
 * @param item - The item containing filename/folder.
 * @param base - The base endpoint type (default: 'api/download').
 * @returns The fully constructed download URI.
 */
const makeDownload = (config: any, item: { folder?: string; filename: string }, base: string = 'api/download'): string => {
  let baseDir = 'api/player/m3u8/video/'
  if ('m3u8' !== base) {
    baseDir = `${base}/`
  }

  if (item.folder) {
    item.folder = item.folder.replace(/#/g, '%23')
    baseDir += item.folder + '/'
  }

  const url = `/${sTrim(baseDir, '/')}${encodePath(item.filename)}`
  return uri('m3u8' === base ? `${url}.m3u8` : url)
}

/**
 * Format bytes to a human-readable string.
 *
 * @param bytes - The number of bytes.
 * @param decimals - Number of decimal places to include.
 * @returns A formatted size string (e.g., '2.00 MiB').
 */
const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (!+bytes) {
    return '0 Bytes'
  }
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

/**
 * Check if input has non-empty data.
 *
 * @param item - The input (object, array, or JSON string).
 * @returns True if it contains data, false otherwise.
 */
const has_data = (item: any): boolean => {
  if (!item) {
    return false
  }

  if ('string' === typeof item) {
    try {
      item = JSON.parse(item)
    } catch {
      return true
    }
  }

  try {
    if ('object' === typeof item) return Object.keys(item).length > 0
    return item.length > 0
  } catch (e) {
    console.error(e)
    return false
  }
}

/**
 * Toggle a class on a DOM element. Supports array of class names.
 *
 * @param target - The HTML element to toggle classes on.
 * @param className - Class name or array of class names.
 */
const toggleClass = (target: HTMLElement, className: string | string[]): void => {
  if (Array.isArray(className)) {
    className.forEach(cls => toggleClass(target, cls))
    return
  }

  if (target.classList.contains(className)) {
    target.classList.remove(className)
  } else {
    target.classList.add(className)
  }
}

/**
 * Remove specified fields from an object.
 *
 * @param item - Input object.
 * @param fields - Keys to exclude.
 * @returns A new object without the excluded keys.
 */
const cleanObject = <T extends Record<string, any>>(item: T, fields: string[] = []): Partial<T> => {
  if (!item || typeof item !== 'object' || fields.length < 1) return item
  const cleaned: Partial<T> = {}
  for (const key of Object.keys(item)) {
    if (!fields.includes(key)) {
      cleaned[key as keyof T] = item[key]
    }
  }
  return cleaned
}

/**
 * Prefix URL with baseURL if needed.
 *
 * @param u - The input path.
 * @returns The fully prefixed URI.
 */
const uri = (u: string): string => {
  if (!u || '/' === runtimeConfig.app.baseURL || !u.startsWith('/')) {
    return u
  }

  if (u.startsWith(runtimeConfig.app.baseURL)) {
    return u
  }

  return `${eTrim(runtimeConfig.app.baseURL, '/')}/${sTrim(u, '/')}`
}

/**
 * Format seconds into HH:MM:SS or MM:SS.
 *
 * @param seconds - Time in seconds.
 * @returns A time string.
 */
const formatTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const pad = (n: number): string => n.toString().padStart(2, '0')

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`
  }

  if (mins > 0) {
    return `${pad(mins)}:${pad(secs)}`
  }

  return `${secs}`
}

/**
 * Pause execution for a number of seconds.
 *
 * @param seconds - Number of seconds to sleep.
 * @returns A promise that resolves after the delay.
 */
const sleep = (seconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, seconds * 1000))

/**
 * Waits for the test function to return a truthy value.
 *
 * @param test - The function to test
 * @param timeout_ms - The maximum time to wait in milliseconds.
 * @param frequency - The frequency to check the test function in milliseconds.
 *
 * @returns The result of the test function.
 */
const awaiter = async (test: Function, timeout_ms: number = 20 * 1000, frequency: number = 200) => {
  if (typeof (test) != "function") {
    throw new Error("test should be a function in awaiter(test, [timeout_ms], [frequency])")
  }

  const isNotTruthy = (val: any) => val === undefined || val === false || val === null || val.length === 0;
  const endTime: number = Date.now() + timeout_ms;

  let result = test();

  while (isNotTruthy(result)) {
    if (Date.now() > endTime) {
      return false;
    }
    await sleep(frequency);
    result = test();
  }

  return result;
}

/**
 * Encode a JavaScript object into a URL-safe base64 string.
 *
 * @param obj - The object to encode.
 * @returns A URL-safe base64-encoded string.
 */
const encode = (obj: Record<string, any>): string => {
  const jsonStr = JSON.stringify(obj);
  const utf8Bytes = new TextEncoder().encode(jsonStr);
  const binary = String.fromCharCode(...utf8Bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a URL-safe base64 string into an object.
 *
 * @param str - The URL-safe base64-encoded string.
 * @returns The decoded JavaScript object.
 */
const decode = (str: string): object => {
  const base64 = str
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(str.length + (4 - str.length % 4) % 4, '=');

  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const jsonStr = new TextDecoder().decode(bytes);
  return JSON.parse(jsonStr);
}

export {
  separators, convertCliOptions, getSeparatorsName, iTrim, eTrim, sTrim, ucFirst,
  getValue, ag, ag_set, awaitElement, r, copyText, dEvent, makePagination, encodePath,
  request, removeANSIColors, dec2hex, makeId, basename, dirname, getQueryParams,
  makeDownload, formatBytes, has_data, toggleClass, cleanObject, uri, formatTime,
  sleep, awaiter, encode, decode
}
