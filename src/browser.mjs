import { spawn } from 'node:child_process'

/**
 * The OS command that opens a URL in the default browser. Windows uses
 * rundll32 rather than `cmd /c start`, so `&` and other characters in the URL
 * are never parsed by cmd.
 * @param {string} url
 * @param {NodeJS.Platform} platform
 * @returns {[string, string[]]}
 */
export function openCommand(url, platform = process.platform) {
  if (platform === 'darwin') return ['open', [url]]
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]]
  return ['xdg-open', [url]]
}

/**
 * Open the card in the person's browser. When no browser can be launched and
 * a person is at this terminal, print the link for them instead. The link is
 * never printed to a non-terminal stream, where an agent would read it.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export function openInBrowser(url) {
  // KEYPROMPT_BROWSER: a specific browser (or test driver) executable, given the URL as its only argument.
  const [command, args] = process.env.KEYPROMPT_BROWSER ? [process.env.KEYPROMPT_BROWSER, [url]] : openCommand(url)
  return new Promise((resolve) => {
    const fallback = () => {
      if (process.stderr.isTTY) {
        process.stderr.write(`Open this link in your browser to enter the secret:\n  ${url}\n`)
        resolve(true)
      } else {
        resolve(false)
      }
    }
    let child
    try {
      child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
    } catch {
      fallback()
      return
    }
    child.on('error', fallback)
    child.on('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
}
