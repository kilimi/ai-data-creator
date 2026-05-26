# Storing Backups Outside the Project Folder

## Quick Setup

To store backups outside the project folder, set the `BACKUP_PATH` environment variable before starting Docker:

```bash
# Set the backup path (absolute path on your host machine)
export BACKUP_PATH=/home/lulu/my-backups

# Or add to your .env file or shell profile
echo 'export BACKUP_PATH=/home/lulu/my-backups' >> ~/.bashrc

# Restart Docker containers
cd backend
docker compose down
docker compose up -d
```

## How It Works

The `docker-compose.yml` file uses the `BACKUP_PATH` environment variable:

```yaml
volumes:
  - ${BACKUP_PATH:-./backups}:/app/backups
```

- If `BACKUP_PATH` is set: Uses that absolute path
- If not set: Defaults to `./backups` (relative to project)

## Examples

### Example 1: Backups in Home Directory
```bash
export BACKUP_PATH=/home/lulu/backups
docker compose down && docker compose up -d
```

### Example 2: Backups on External Drive
```bash
export BACKUP_PATH=/mnt/external-drive/ai-data-backups
docker compose down && docker compose up -d
```

### Example 3: Backups in System Backup Directory
```bash
export BACKUP_PATH=/var/backups/lai
docker compose down && docker compose up -d
```

## Important Notes

1. **Path must exist or be creatable**: Docker will create the directory if it doesn't exist (if permissions allow)

2. **Permissions**: Ensure the Docker user has write access to the directory:
   ```bash
   sudo mkdir -p /path/to/backups
   sudo chown -R $USER:$USER /path/to/backups
   ```

3. **Subdirectories**: In the UI, you can still specify subdirectories:
   - Empty path → `/path/to/backups/`
   - "daily" → `/path/to/backups/daily/`
   - "2024/january" → `/path/to/backups/2024/january/`

4. **Persistent Configuration**: To make it permanent, add to your shell profile:
   ```bash
   echo 'export BACKUP_PATH=/home/lulu/my-backups' >> ~/.bashrc
   source ~/.bashrc
   ```

## Verifying the Setup

After setting `BACKUP_PATH` and restarting:

1. Check the mount in the container:
   ```bash
   docker compose exec backend ls -la /app/backups
   ```

2. Check on your host:
   ```bash
   ls -la $BACKUP_PATH
   ```

3. Run a test backup from the UI and verify files appear in your custom location.

## Troubleshooting

**Backup path not working?**
- Verify `BACKUP_PATH` is set: `echo $BACKUP_PATH`
- Check Docker logs: `docker compose logs backend`
- Ensure directory permissions are correct
- Restart containers after setting the variable

**Permission denied errors?**
```bash
sudo chown -R $USER:$USER /path/to/backups
sudo chmod 755 /path/to/backups
```
