"""No Java compilation: parse Java 8 syntax and enforce security invariants.
Run with javalang on PYTHONPATH. These are source-level checks, not Android runtime tests.
"""
from pathlib import Path
import re
import unittest
import javalang

ROOT = Path(__file__).resolve().parents[1] / 'android/src/de/newaii/netcatty'
MAIN = (ROOT / 'MainActivity.java').read_text()
CIPHER = (ROOT / 'CredentialCipher.java').read_text()
TREE = javalang.parse.parse(MAIN)


def method(name):
    node = next(n for _, n in TREE.filter(javalang.tree.MethodDeclaration) if n.name == name)
    declaration_start = sum(len(line) for line in MAIN.splitlines(keepends=True)[:node.position.line - 1])
    start = MAIN.index('{', declaration_start)
    tokens = list(javalang.tokenizer.tokenize(MAIN[start:]))
    depth = 0
    for token in tokens:
        if token.value == '{': depth += 1
        elif token.value == '}':
            depth -= 1
            if depth == 0:
                lines = MAIN[start:].splitlines(keepends=True)
                return ''.join(lines[:token.position.line - 1]) + lines[token.position.line - 1][:token.position.column]
    raise AssertionError(name)


class SecuritySourceChecks(unittest.TestCase):
    def test_all_java_parse(self):
        for path in ROOT.glob('*.java'):
            javalang.parse.parse(path.read_text())

    def test_no_newer_java_apis_or_lambdas(self):
        for path in ROOT.glob('*.java'):
            text = path.read_text()
            for banned in ['List.of(', 'Map.of(', 'Path.of(', '.transferTo(', '.readNBytes(', 'java.time.']:
                self.assertFalse(banned in text, str(path.name) + ': forbidden API ' + banned)
            self.assertFalse(any(t.value == '->' for t in javalang.tokenizer.tokenize(text)))

    def test_tls_before_http_write(self):
        text = method('executeRawHttpSocketRequest')
        self.assertLess(text.index('setEndpointIdentificationAlgorithm("HTTPS")'), text.index('tls.startHandshake()'))
        self.assertLess(text.index('tls.startHandshake()'), text.index('os.write('))
        self.assertIn('sock.close()', text)
        self.assertNotIn('return executeRawHttpSocketRequest(', text)
        self.assertNotIn('setInstanceFollowRedirects(true)', MAIN)

    def test_ssh_trust(self):
        self.assertIn('config.put("StrictHostKeyChecking", "yes")', MAIN)
        self.assertNotIn('"StrictHostKeyChecking", "no"', MAIN)
        self.assertIn('return false;', method('promptYesNo'))

    def test_otp_fails_closed(self):
        text = method('promptKeyboardInteractive')
        self.assertIn('if (code.isEmpty()) return null;', text)
        self.assertNotIn('? code : password', text)
        self.assertIn('if (isOtpPrompt)', text)
        self.assertIn('Invalid Base32 secret', MAIN)

    def test_socks_negotiation_cleanup(self):
        text = method('handleSocks5Client')
        for fragment in ['supportsNoAuth', '(byte) 0xff', 'reserved != 0', 'domainLen == 0', 'targetPort == 0', 'client.setSoTimeout(15000)', 'client.setSoTimeout(0)', 'if (channel != null) channel.disconnect()', 'client.close()']:
            self.assertIn(fragment, text)

    def test_sftp_full_mutation_api(self):
        for name, operation in [('sftpWriteFile', 'sftp.put('), ('sftpMkdir', 'sftp.mkdir('), ('sftpDelete', 'deleteSftpEntryRecursive('), ('sftpRename', 'sftp.rename('), ('sftpChmod', 'sftp.chmod('), ('sftpStreamUploadFromLocal', 'sftp.put(')]:
            text = method(name)
            self.assertIn(operation, text)
            self.assertIn('synchronized (sftp)', text)
            self.assertIn('res.put("ok", false)', text)
        self.assertNotIn('SFTP is read-only', MAIN)

    def test_download_staging_and_limit(self):
        read = method('sftpReadFile')
        self.assertIn('throw new java.io.IOException("File exceeds', read)
        self.assertNotIn('break;', read)
        text = method('sftpStreamDownloadToLocal')
        self.assertNotIn('new FileOutputStream(destFile)', text)
        self.assertNotIn('destFile.delete()', text)
        for part in ['File.createTempFile(', 'new FileOutputStream(stagingFile)', 'fos.getFD().sync()', 'stagingFile.length() != totalBytes', 'android.system.Os.rename(', 'stagingFile.delete()', 'res.put("ok", false)']:
            self.assertIn(part, text)
        self.assertLess(text.index('cancelledTransfers.get(transferId)', text.index('fos.getFD().sync()')), text.index('android.system.Os.rename('))

    def test_upload_stages_before_replace(self):
        text = method('sftpStreamUploadFromLocal')
        self.assertIn('sftp.put(input, uploadPath,', text)
        self.assertIn('sftp.rename(uploadPath, remotePath)', text)
        self.assertIn('sftp.rm(uploadPath)', text)

    def test_keystore_api(self):
        for name in ['credentialsAvailable', 'credentialsEncrypt', 'credentialsDecrypt']:
            node = next(n for _, n in TREE.filter(javalang.tree.MethodDeclaration) if n.name == name)
            self.assertIn('JavascriptInterface', [a.name for a in node.annotations])
        for text in ['AndroidKeyStore', 'AES/GCM/NoPadding', 'enc:v1:android-keystore:', 'setRandomizedEncryptionRequired(true)', 'cipher.updateAAD(AAD)', 'new GCMParameterSpec(128', 'key(false)']:
            self.assertIn(text, CIPHER)
        self.assertIn('catch (Exception e) { return ""; }', method('credentialsEncrypt'))
        self.assertNotIn('return plaintext', CIPHER)


if __name__ == '__main__':
    unittest.main(verbosity=2)
