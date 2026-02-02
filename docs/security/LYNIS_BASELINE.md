# Lynis Security Baseline Audit

**Date:** 2026-01-28
**Lynis Version:** 3.0.9
**System:** Ubuntu 24.04.3 LTS (Kernel 6.8.0-90-generic)
**Scan Type:** Full audit (`lynis audit system`)

## Baseline Hardening Index: 67/100

**Tests performed:** 259
**Firewall:** Active (UFW)
**Malware scanner:** Not installed

## Warnings

No critical warnings flagged.

## Suggestions (39 total)

### System Updates
- LYNIS: Release >4 months old, check for updates

### Debian/APT Hardening
- DEB-0280: Install `libpam-tmpdir` for PAM session temp dirs
- DEB-0810: Install `apt-listbugs` for critical bug alerts before install
- DEB-0811: Install `apt-listchanges` for change display before upgrade
- DEB-0880: Copy `jail.conf` to `jail.local` to preserve fail2ban config across updates

### Boot Security
- BOOT-5122: Set GRUB password to prevent boot config changes
- BOOT-5264: Harden system services (use `systemd-analyze security SERVICE`)

### Kernel
- KRNL-5820: Consider disabling core dumps in `/etc/security/limits.conf`
- KRNL-6000: Some sysctl values differ from scan profile

### Authentication & Passwords
- AUTH-9229: Check PAM configuration, add rounds for password encryption
- AUTH-9230: Configure password hashing rounds in `/etc/login.defs`
- AUTH-9262: Install PAM module for password strength testing (pam_cracklib/pam_passwdqc)
- AUTH-9282: Set expire dates for password-protected accounts
- AUTH-9286: Configure minimum/maximum password age in `/etc/login.defs`
- AUTH-9328: Default umask in `/etc/login.defs` could be stricter (027)

### Filesystem
- FILE-6310: Separate partitions for `/home`, `/tmp`, `/var`
- FILE-7524: Consider restricting file permissions

### USB
- USB-1000: Disable USB storage drivers if unused

### Packages
- PKGS-7370: Install `debsums` for package verification
- PKGS-7394: Install `apt-show-versions` for patch management

### Network
- NETW-3200: Evaluate need for protocols: dccp, sctp, rds, tipc
- FIRE-4513: Check iptables for unused rules

### SSH Hardening
- SSH-7408: Consider hardening:
  - `AllowTcpForwarding`: YES -> NO
  - `ClientAliveCountMax`: 3 -> 2
  - `LogLevel`: INFO -> VERBOSE
  - `MaxSessions`: 10 -> 2
  - `TCPKeepAlive`: YES -> NO
  - `AllowAgentForwarding`: YES -> NO

### Logging & Accounting
- LOGG-2154: Enable external logging host
- ACCT-9622: Enable process accounting
- ACCT-9626: Enable sysstat
- ACCT-9628: Enable auditd

### File Integrity & Tools
- FINT-4350: Install file integrity monitoring tool
- TOOL-5002: Determine automation tools for system management

### Hardening
- HRDN-7222: Restrict compiler access to root only
- HRDN-7230: Install malware scanner (rkhunter, chkrootkit, OSSEC)

## Success Criteria

Post-deployment Lynis audit must show:
- Hardening index >= 67
- No new warnings introduced
- All new suggestions documented and addressed where reasonable
