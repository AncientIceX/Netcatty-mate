#!/usr/bin/env bash
set -euo pipefail
# Loopback-only disposable server and files. Never connects to a user host.
ROOT=$(mktemp -d "${RUNNER_TEMP:?}/netcatty-sftp.XXXXXX")
SSHD_PID=""
cleanup() {
  result=$?
  if [ "$result" -ne 0 ] && [ -f "$ROOT/sshd.log" ]; then sudo cat "$ROOT/sshd.log"; fi
  if [ -n "$SSHD_PID" ]; then sudo kill "$SSHD_PID" 2>/dev/null || true; fi
  sudo rm -rf "$ROOT"
}
trap cleanup EXIT
sudo apt-get update -qq
sudo apt-get install -y -qq openssh-server
chmod 755 "$ROOT"
ssh-keygen -q -t ed25519 -N '' -f "$ROOT/host"
ssh-keygen -q -t ed25519 -N '' -f "$ROOT/client"
cp "$ROOT/client.pub" "$ROOT/authorized_keys"
mkdir "$ROOT/files" "$ROOT/classes"
printf 'foreign original' > "$ROOT/files/foreign-owner"
chmod 644 "$ROOT/files/foreign-owner"
sudo chown 65534:65534 "$ROOT/files/foreign-owner"
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
printf 'Port %s\nListenAddress 127.0.0.1\nHostKey %s/host\nPidFile %s/sshd.pid\nAuthorizedKeysFile %s/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM yes\nAllowUsers %s\nSubsystem sftp internal-sftp\n' "$PORT" "$ROOT" "$ROOT" "$ROOT" "$(id -un)" > "$ROOT/sshd_config"
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -f "$ROOT/sshd_config" -E "$ROOT/sshd.log"
SSHD_PID=$(sudo cat "$ROOT/sshd.pid")
printf '[127.0.0.1]:%s %s\n' "$PORT" "$(cut -d ' ' -f 1,2 "$ROOT/host.pub")" > "$ROOT/known_hosts"
javac -source 8 -target 8 -cp build_libs/jsch.jar -d "$ROOT/classes" android/src/de/newaii/netcatty/SftpFiles.java scripts/SftpFilesIntegration.java
java -cp "$ROOT/classes:build_libs/jsch.jar" SftpFilesIntegration "$ROOT/client" "$ROOT/known_hosts" "$PORT" "$ROOT/files"
