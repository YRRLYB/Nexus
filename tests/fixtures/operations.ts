export function checkedEnvironment(overrides: Record<string, string> = {}) {
  const fields = {
    system: 'Linux',
    distribution: 'debian',
    version: '12',
    architecture: 'x86_64',
    user: 'root',
    uid: '0',
    sudo: '1',
    bash: '1',
    curl: '1',
    unzip: '1',
    sha256sum: '1',
    systemctl: '1',
    systemd: '1',
    docker: '0',
    baota: '0',
    probe: '0',
    '3x-ui': '0',
    otherProbe: '0',
    ...overrides,
  };
  return (
    '__NEXUS_CHECK__\n' +
    Object.entries(fields)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') +
    '\n'
  );
}
