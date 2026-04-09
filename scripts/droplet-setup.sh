#!/bin/bash
# Claws Container Host Setup Script
# Run this on the DigitalOcean droplet via SSH:
#   ssh root@134.209.166.81 'bash -s' < scripts/droplet-setup.sh
# Or paste the contents into the SSH session.

set -euo pipefail

echo "=== Claws Container Host Setup ==="

# 1. Update system
echo ">>> Updating system packages..."
apt update -y && apt upgrade -y

# 2. Verify Docker
echo ">>> Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    apt install -y docker.io docker-compose-plugin
fi
systemctl enable docker
systemctl start docker
docker --version

# 3. Install Node.js 20 (for the container management agent)
echo ">>> Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
node --version
npm --version

# 4. Configure firewall
echo ">>> Configuring firewall..."
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh          # Port 22
ufw allow 9876/tcp     # Container management agent
# Don't allow direct access to container ports from outside
ufw --force enable

# 5. Create the container management agent
echo ">>> Setting up container management agent..."
mkdir -p /opt/claws-agent
cat > /opt/claws-agent/package.json << 'PACKAGE_EOF'
{
  "name": "claws-container-agent",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "express": "^4.21.0"
  }
}
PACKAGE_EOF

cat > /opt/claws-agent/agent.mjs << 'AGENT_EOF'
import express from 'express';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const app = express();
app.use(express.json({ limit: '10mb' }));

const AGENT_SECRET = process.env.AGENT_SECRET;
if (!AGENT_SECRET) {
  console.error('AGENT_SECRET env var required');
  process.exit(1);
}

// Auth middleware
app.use((req, res, next) => {
  if (req.path === '/health' && req.method === 'GET') return next();
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${AGENT_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Health check (no auth)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', docker: getDockerVersion() });
});

function getDockerVersion() {
  try { return execSync('docker --version', { encoding: 'utf-8' }).trim(); }
  catch { return 'unknown'; }
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf-8', timeout: 60000 }).trim();
}

// === CONTAINER MANAGEMENT ===

// Create and start a container
app.post('/containers/create', async (req, res) => {
  try {
    const {
      name,
      image,
      env,
      memoryMb,
      cpus,
      volumeName,
      volumePath,
    } = req.body;

    if (!name || !image) {
      return res.status(400).json({ error: 'name and image are required' });
    }

    // Create named volume if it doesn't exist
    if (volumeName) {
      try { run(`docker volume inspect ${volumeName}`); }
      catch { run(`docker volume create ${volumeName}`); }
    }

    // Build docker run command
    const envFlags = Object.entries(env || {})
      .map(([k, v]) => `-e ${k}=${JSON.stringify(String(v))}`)
      .join(' ');

    const volumeFlag = volumeName && volumePath
      ? `-v ${volumeName}:${volumePath}`
      : '';

    const mem = memoryMb || 1024;
    const cpu = cpus || 1.0;

    // Remove existing container with same name (if any)
    try { run(`docker rm -f ${name}`); } catch { /* ignore */ }

    const cmd = [
      'docker run -d',
      `--name ${name}`,
      `--memory ${mem}m`,
      `--cpus ${cpu}`,
      '--pids-limit 256',
      '--security-opt no-new-privileges',
      '--init',
      '--restart on-failure:5',
      '-p 0:18789',
      volumeFlag,
      envFlags,
      image,
    ].filter(Boolean).join(' ');

    const containerId = run(cmd);

    // Get the assigned host port
    const inspect = JSON.parse(run(`docker inspect ${containerId}`));
    const hostPort = inspect[0]?.NetworkSettings?.Ports?.['18789/tcp']?.[0]?.HostPort;

    res.json({
      success: true,
      containerId: containerId.substring(0, 12),
      name,
      hostPort: hostPort ? parseInt(hostPort) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop a container
app.post('/containers/:name/stop', (req, res) => {
  try {
    run(`docker stop ${req.params.name}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start a stopped container
app.post('/containers/:name/start', (req, res) => {
  try {
    run(`docker start ${req.params.name}`);
    const inspect = JSON.parse(run(`docker inspect ${req.params.name}`));
    const hostPort = inspect[0]?.NetworkSettings?.Ports?.['18789/tcp']?.[0]?.HostPort;
    res.json({ success: true, hostPort: hostPort ? parseInt(hostPort) : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Restart a container
app.post('/containers/:name/restart', (req, res) => {
  try {
    run(`docker restart ${req.params.name}`);
    const inspect = JSON.parse(run(`docker inspect ${req.params.name}`));
    const hostPort = inspect[0]?.NetworkSettings?.Ports?.['18789/tcp']?.[0]?.HostPort;
    res.json({ success: true, hostPort: hostPort ? parseInt(hostPort) : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remove a container (stop + delete)
app.delete('/containers/:name', (req, res) => {
  try {
    try { run(`docker stop ${req.params.name}`); } catch { /* already stopped */ }
    run(`docker rm ${req.params.name}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Inspect a container (status, ports, health)
app.get('/containers/:name', (req, res) => {
  try {
    const inspect = JSON.parse(run(`docker inspect ${req.params.name}`))[0];
    const hostPort = inspect?.NetworkSettings?.Ports?.['18789/tcp']?.[0]?.HostPort;
    res.json({
      id: inspect.Id?.substring(0, 12),
      name: inspect.Name?.replace(/^\//, ''),
      status: inspect.State?.Status,
      running: inspect.State?.Running,
      startedAt: inspect.State?.StartedAt,
      restartCount: inspect.RestartCount,
      hostPort: hostPort ? parseInt(hostPort) : null,
    });
  } catch (error) {
    res.status(404).json({ error: `Container ${req.params.name} not found` });
  }
});

// Get container logs
app.get('/containers/:name/logs', (req, res) => {
  try {
    const tail = req.query.tail || 100;
    const logs = run(`docker logs --tail ${tail} ${req.params.name} 2>&1`);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Write files to a container's volume via a temp Alpine container
app.post('/volumes/:volumeName/files', (req, res) => {
  try {
    const { volumeName } = req.params;
    const { files } = req.body;

    const tempName = `temp-writer-${Date.now()}`;
    run(`docker run -d --name ${tempName} -v ${volumeName}:/data alpine:latest sleep 30`);

    try {
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = `/data/${filePath}`;
        const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
        if (dir) {
          run(`docker exec ${tempName} mkdir -p "${dir}"`);
        }
        writeFileSync('/tmp/claws-file-tmp', String(content));
        run(`docker cp /tmp/claws-file-tmp ${tempName}:${fullPath}`);
      }
      res.json({ success: true, filesWritten: Object.keys(files).length });
    } finally {
      try { run(`docker rm -f ${tempName}`); } catch { /* cleanup */ }
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// List all claws containers
app.get('/containers', (_req, res) => {
  try {
    const output = run('docker ps -a --filter "name=claw-" --format "{{json .}}"');
    const containers = output
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    res.json({ containers });
  } catch {
    res.json({ containers: [] });
  }
});

// Pull a Docker image
app.post('/images/pull', (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'image required' });

  try {
    run(`docker pull ${image}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 9876;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Claws Container Agent running on port ${PORT}`);
  console.log(`Docker: ${getDockerVersion()}`);
});
AGENT_EOF

# Install dependencies
cd /opt/claws-agent
npm install

# 6. Generate agent secret
AGENT_SECRET=$(openssl rand -hex 32)
echo ">>> Generated AGENT_SECRET: $AGENT_SECRET"
echo ">>> SAVE THIS — you'll need it for Vercel env vars"

# 7. Create systemd service
cat > /etc/systemd/system/claws-agent.service << SYSTEMD_EOF
[Unit]
Description=Claws Container Management Agent
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/claws-agent
Environment=AGENT_SECRET=$AGENT_SECRET
Environment=PORT=9876
ExecStart=/usr/bin/node agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

systemctl daemon-reload
systemctl enable claws-agent
systemctl start claws-agent

# 8. Verify
sleep 2
curl -s http://localhost:9876/health | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin), indent=2))"

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Container Agent: http://134.209.166.81:9876"
echo "AGENT_SECRET: $AGENT_SECRET"
echo ""
echo "Add to Vercel env vars:"
echo "  CONTAINER_HOST=http://134.209.166.81:9876"
echo "  CONTAINER_AGENT_SECRET=$AGENT_SECRET"
echo ""
echo "Test from your machine:"
echo "  curl -H 'Authorization: Bearer $AGENT_SECRET' http://134.209.166.81:9876/health"
