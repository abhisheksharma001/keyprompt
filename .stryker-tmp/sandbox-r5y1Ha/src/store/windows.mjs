// @ts-nocheck
import { helperError } from '../errors.mjs'
import { runHelper } from '../exec.mjs'

/**
 * Windows Credential Manager ("Generic credentials", target `keyprompt:NAME`,
 * persisted per user on this machine) through the Win32 CredRead/CredWrite/
 * CredDelete API, driven from the PowerShell 5.1 that ships with Windows.
 * The script travels in -EncodedCommand; the secret only through stdin and
 * stdout as raw UTF-8 bytes.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class KeypromptCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CredDeleteW(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr buffer);
  const uint GENERIC = 1;
  const uint PERSIST_LOCAL_MACHINE = 2;
  const int NOT_FOUND = 1168;
  public static void Write(string target, string user, byte[] secret) {
    var c = new CREDENTIAL();
    c.Type = GENERIC; c.TargetName = target; c.UserName = user; c.Persist = PERSIST_LOCAL_MACHINE;
    c.CredentialBlobSize = (uint)secret.Length;
    c.CredentialBlob = Marshal.AllocHGlobal(Math.Max(secret.Length, 1));
    try {
      Marshal.Copy(secret, 0, c.CredentialBlob, secret.Length);
      if (!CredWriteW(ref c, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      Marshal.FreeHGlobal(c.CredentialBlob);
    }
  }
  public static byte[] Read(string target) {
    IntPtr p;
    if (!CredReadW(target, GENERIC, 0, out p)) {
      int e = Marshal.GetLastWin32Error();
      if (e == NOT_FOUND) return null;
      throw new Win32Exception(e);
    }
    try {
      var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      var b = new byte[c.CredentialBlobSize];
      if (b.Length > 0) Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      return b;
    } finally {
      CredFree(p);
    }
  }
  public static bool Delete(string target) {
    if (CredDeleteW(target, GENERIC, 0)) return true;
    int e = Marshal.GetLastWin32Error();
    if (e == NOT_FOUND) return false;
    throw new Win32Exception(e);
  }
}
'@
$target = $env:KEYPROMPT_TARGET
$stdout = [Console]::OpenStandardOutput()
switch ($env:KEYPROMPT_OP) {
  'write' {
    $stdin = [Console]::OpenStandardInput()
    $buffer = New-Object System.IO.MemoryStream
    $stdin.CopyTo($buffer)
    $text = [System.Text.Encoding]::UTF8.GetString($buffer.ToArray())
    # Stored as UTF-16LE, the encoding Credential Manager and other tools expect.
    [KeypromptCred]::Write($target, $env:KEYPROMPT_USER, [System.Text.Encoding]::Unicode.GetBytes($text))
    exit 0
  }
  'read' {
    $blob = [KeypromptCred]::Read($target)
    if ($null -eq $blob) { exit 3 }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([System.Text.Encoding]::Unicode.GetString($blob))
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
    exit 0
  }
  'delete' {
    if ([KeypromptCred]::Delete($target)) { exit 0 } else { exit 3 }
  }
}
exit 2
`

const ENCODED = Buffer.from(SCRIPT, 'utf16le').toString('base64')

/**
 * @param {'read' | 'write' | 'delete'} op
 * @param {string} name
 * @param {string} [input]
 */
function credential(op, name, input) {
  return runHelper(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED],
    {
      input,
      env: { ...process.env, KEYPROMPT_OP: op, KEYPROMPT_TARGET: `keyprompt:${name}`, KEYPROMPT_USER: name },
    },
  )
}

/** @type {import('./index.mjs').SecretStore} */
export const windowsStore = {
  id: 'windows-credential-manager',
  label: 'Windows Credential Manager',
  // CRED_MAX_CREDENTIAL_BLOB_SIZE is 2,560 bytes, stored as UTF-16 (2 bytes per character).
  maxValueLength: 1280,

  async read(name) {
    const { code, stdout, stderr } = await credential('read', name)
    if (code === 3) return null
    if (code !== 0) throw helperError(`Could not read ${name} from Windows Credential Manager`, stderr)
    return stdout.toString('utf8')
  },

  async write(name, value) {
    const { code, stderr } = await credential('write', name, value)
    if (code !== 0) throw helperError(`Could not save ${name} to Windows Credential Manager`, stderr)
  },

  async remove(name) {
    const { code, stderr } = await credential('delete', name)
    if (code === 3) return false
    if (code !== 0) throw helperError(`Could not delete ${name} from Windows Credential Manager`, stderr)
    return true
  },
}
