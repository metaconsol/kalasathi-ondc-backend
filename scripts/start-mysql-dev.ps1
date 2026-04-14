param(
    [string]$Action = "start"
)

# Colors for output
function Write-Info { Write-Host "[INFO] $args" -ForegroundColor Green }
function Write-Error { Write-Host "[ERROR] $args" -ForegroundColor Red }
function Write-Warning { Write-Host "[WARNING] $args" -ForegroundColor Yellow }


# Check if config file exists
if (-not (Test-Path "$PSScriptRoot\mysql-config-dev.json")) {
    Write-Error "Config file not found"
    exit 1
}

# Read config file
$config = Get-Content "$PSScriptRoot\mysql-config-dev.json" | ConvertFrom-Json
$ContainerName = $config.dockerContainerName
$MySQLPort = $config.dockerPort
$MySQLDatabase = $config.dockerDatabase
$MySQLUser = $config.dockerUser
$MySQLPassword = $config.dockerPassword
$MySQLHost = $config.dockerHost
$MySQLImage = $config.dockerImage

Write-Host "----------------------------------------" -ForegroundColor Green
Write-Host "ContainerName: $ContainerName" -ForegroundColor Yellow
Write-Host "MySQLImage: $MySQLImage" -ForegroundColor Yellow
Write-Host "MySQLUser: $MySQLUser" -ForegroundColor Yellow
Write-Host "MySQLPassword: $MySQLPassword" -ForegroundColor Yellow
Write-Host "MySQLHost: $MySQLHost" -ForegroundColor Yellow
Write-Host "MySQLPort: $MySQLPort" -ForegroundColor Yellow
Write-Host "MySQLDatabase: $MySQLDatabase" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Yellow


if (-not $ContainerName -or -not $MySQLPassword -or -not $MySQLPort -or -not $MySQLDatabase -or -not $MySQLUser -or -not $MySQLPassword -or -not $MySQLHost -or -not $MySQLImage) {
    Write-Error "Config file is invalid"
    exit 1
}



# Check if Docker is running
function Test-DockerRunning {
    try {
        docker info > $null 2>&1
        return $true
    }
    catch {
        return $false
    }
}

# Check if container exists
function Test-ContainerExists {
    $exists = docker ps -a --format "table {{.Names}}" | Select-String $ContainerName
    return ($exists -ne $null)
}

# Check if container is running
function Test-ContainerRunning {
    $running = docker ps --format "table {{.Names}}" | Select-String $ContainerName
    return ($running -ne $null)
}

# Start MySQL container
function Start-MySQLContainer {
    Write-Info "Starting MySQL container '$ContainerName'..."
    
    # Create data directory for persistent storage
    $dataDir = "$PSScriptRoot\mysql-data"
    if (-not (Test-Path $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
        Write-Info "Created data directory: $dataDir"
    }
    
    # Create init directory
    $initDir = "$PSScriptRoot\mysql-init"
    if (-not (Test-Path $initDir)) {
        New-Item -ItemType Directory -Path $initDir -Force | Out-Null
        Write-Info "Created init directory: $initDir"
    }
    
    docker run -d `
        --name $ContainerName `
        -e MYSQL_ROOT_PASSWORD=$MySQLPassword `
        -e MYSQL_DATABASE=$MySQLDatabase `
        -e MYSQL_USER=$MySQLUser `
        -e MYSQL_PASSWORD=$MySQLPassword `
        -p "${MySQLPort}:3306" `
        -v "${dataDir}:/var/lib/mysql" `
        -v "${initDir}:/docker-entrypoint-initdb.d" `
        --restart unless-stopped `
        $MySQLImage
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "MySQL container started successfully!"
        Write-Info "Container Name: $ContainerName"
        Write-Info "Image: $MySQLImage"
        Write-Info "User: $MySQLUser"
        Write-Info "Root Password: $MySQLPassword"
        Write-Info "Host: $MySQLHost"
        Write-Info "Port: $MySQLPort"
        Write-Info "Database: $MySQLDatabase"
        
        # Wait for MySQL to be ready
        Write-Info "Waiting for MySQL to be ready..."
        Start-Sleep -Seconds 10
        
        # Test connection
        Test-MySQLConnection
    }
    else {
        Write-Error "Failed to start MySQL container"
    }
}

# Stop MySQL container
function Stop-MySQLContainer {
    Write-Info "Stopping MySQL container '$ContainerName'..."
    docker stop $ContainerName
    Write-Info "Container stopped"
}

# Remove MySQL container
function Remove-MySQLContainer {
    Write-Info "Removing MySQL container '$ContainerName'..."
    docker rm $ContainerName
    Write-Info "Container removed"
}

# Enter MySQL shell
function Enter-MySQLShell {
    Write-Info "Connecting to MySQL shell..."
    docker exec -it $ContainerName mysql -u"$MySQLUser" -p"$MySQLPassword"
}

# Execute SQL command
function Execute-SQL {
    param([string]$SQLCommand)
    docker exec $ContainerName mysql -u"$MySQLUser" -p"$MySQLPassword" -e "$SQLCommand"
}

# Execute SQL file (FIXED: using Get-Content and piping)
function Execute-SQLFile {
    param([string]$SQLFilePath)
    
    if (-not (Test-Path $SQLFilePath)) {
        Write-Error "SQL file not found: $SQLFilePath"
        return
    }
    
    Write-Info "Executing SQL file: $SQLFilePath"
    
    # Read the file content and pipe to docker exec
    Get-Content $SQLFilePath | docker exec -i $ContainerName mysql -u"$MySQLUser" -p"$MySQLPassword"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "SQL file executed successfully"
    }
    else {
        Write-Error "Failed to execute SQL file"
    }
}

# Test MySQL connection
function Test-MySQLConnection {
    Write-Info "Testing MySQL connection..."
    try {
        $result = docker exec $ContainerName mysqladmin ping -u"$MySQLUser" -p"$MySQLPassword" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "MySQL is ready and accepting connections!"
            
            # Display database info
            Execute-SQL "SHOW DATABASES;"
        }
        else {
            Write-Warning "MySQL is not ready yet. You can check logs with: docker logs $ContainerName"
        }
    }
    catch {
        Write-Warning "Unable to connect to MySQL"
    }
}

# Show container logs
function Show-Logs {
    Write-Info "Showing last 50 lines of logs..."
    docker logs --tail 50 $ContainerName
}

# Backup database (FIXED: using PowerShell redirection)
function Backup-Database {
    param([string]$BackupPath = "$PSScriptRoot\backups")
    
    if (-not (Test-Path $BackupPath)) {
        New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
    }
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupFile = "$BackupPath\mysql_backup_$timestamp.sql"
    
    Write-Info "Creating database backup: $backupFile"
    
    # Using cmd /c to redirect output properly
    $backupCommand = "docker exec $ContainerName mysqldump -u"$MySQLUser" -p"$MySQLPassword" --all-databases"
    Invoke-Expression $backupCommand | Out-File -FilePath $backupFile -Encoding utf8
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Backup completed!"
        $fileInfo = Get-Item $backupFile
        Write-Info "Backup size: $([math]::Round($fileInfo.Length / 1KB, 2)) KB"
    }
    else {
        Write-Error "Backup failed"
    }
}

# Restore database from backup (FIXED: using Get-Content)
function Restore-Database {
    param([string]$BackupFilePath)
    
    if (-not (Test-Path $BackupFilePath)) {
        Write-Error "Backup file not found: $BackupFilePath"
        return
    }
    
    Write-Info "Restoring database from: $BackupFilePath"
    
    # Read the backup file and pipe to mysql
    Get-Content $BackupFilePath | docker exec -i $ContainerName mysql -u"$MySQLUser" -p"$MySQLPassword"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Database restored successfully!"
    }
    else {
        Write-Error "Restore failed"
    }
}

# List available backups
function List-Backups {
    param([string]$BackupPath = "$PSScriptRoot\backups")
    
    if (Test-Path $BackupPath) {
        $backups = Get-ChildItem $BackupPath -Filter "*.sql" | Sort-Object LastWriteTime -Descending
        if ($backups.Count -gt 0) {
            Write-Info "Available backups:"
            $backups | ForEach-Object { Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1KB, 2)) KB) - $($_.LastWriteTime)" }
        }
        else {
            Write-Warning "No backups found"
        }
    }
    else {
        Write-Warning "Backup directory not found"
    }
}

# Show container status
function Show-Status {
    docker ps -a --filter "name=$ContainerName"
    Test-MySQLConnection
}

# Interactive menu
function Show-Menu {
    Clear-Host
    Write-Host "===== MySQL Docker Development Setup =====" -ForegroundColor Cyan
    Write-Host "1. Start MySQL Container"
    Write-Host "2. Stop MySQL Container"
    Write-Host "3. Restart MySQL Container"
    Write-Host "4. Remove MySQL Container"
    Write-Host "5. Enter MySQL Shell"
    Write-Host "6. Show Container Status"
    Write-Host "7. Show Logs"
    Write-Host "8. Backup Database"
    Write-Host "9. Restore Database"
    Write-Host "10. Execute SQL File"
    Write-Host "11. List Backups"
    Write-Host "0. Exit"
    Write-Host "==========================================" -ForegroundColor Cyan
}

# Main execution
if (-not (Test-DockerRunning)) {
    Write-Error "Docker is not running. Please start Docker Desktop first."
    exit 1
}

switch ($Action.ToLower()) {
    "start" { 
        if (-not (Test-ContainerExists)) {
            Start-MySQLContainer
        }
        elseif (-not (Test-ContainerRunning)) {
            Write-Info "Container exists but not running. Starting..."
            docker start $ContainerName
            Test-MySQLConnection
        }
        else {
            Write-Info "Container is already running"
            Test-MySQLConnection
        }
    }
    "stop" { Stop-MySQLContainer }
    "restart" { 
        Stop-MySQLContainer
        Start-Sleep -Seconds 2
        Start-MySQLContainer
    }
    "remove" { 
        if (Test-ContainerRunning) { Stop-MySQLContainer }
        Remove-MySQLContainer
    }
    "shell" { Enter-MySQLShell }
    "status" { Show-Status }
    "logs" { Show-Logs }
    "backup" { Backup-Database }
    "restore" { 
        if ($args.Count -gt 0) {
            Restore-Database -BackupFilePath $args[0]
        }
        else {
            Write-Error "Please provide backup file path"
            Write-Info "Usage: .\start-mysql-dev.ps1 restore C:\path\to\backup.sql"
        }
    }
    "exec" {
        if ($args.Count -gt 0) {
            Execute-SQLFile -SQLFilePath $args[0]
        }
        else {
            Write-Error "Please provide SQL file path"
            Write-Info "Usage: .\start-mysql-dev.ps1 exec C:\path\to\file.sql"
        }
    }
    "list-backups" { List-Backups }
    "menu" { 
        do {
            Show-Menu
            $choice = Read-Host "Select option"
            switch ($choice) {
                "1" { Start-MySQLContainer }
                "2" { Stop-MySQLContainer }
                "3" { 
                    Stop-MySQLContainer
                    Start-Sleep -Seconds 2
                    Start-MySQLContainer
                }
                "4" { 
                    if (Test-ContainerRunning) { Stop-MySQLContainer }
                    Remove-MySQLContainer
                }
                "5" { Enter-MySQLShell }
                "6" { Show-Status }
                "7" { Show-Logs }
                "8" { Backup-Database }
                "9" { 
                    $backupFile = Read-Host "Enter backup file path"
                    if ($backupFile) {
                        Restore-Database -BackupFilePath $backupFile
                    }
                }
                "10" {
                    $sqlFile = Read-Host "Enter SQL file path"
                    if ($sqlFile) {
                        Execute-SQLFile -SQLFilePath $sqlFile
                    }
                }
                "11" { List-Backups }
                "0" { Write-Info "Exiting..." }
                default { Write-Error "Invalid option" }
            }
            if ($choice -ne "0") {
                Read-Host "`nPress Enter to continue"
            }
        } while ($choice -ne "0")
    }
    default { 
        Write-Error "Unknown action. Available actions:"
        Write-Info "  start, stop, restart, remove, shell, status, logs"
        Write-Info "  backup, restore, exec, list-backups, menu"
        Write-Host ""
        Write-Info "Examples:"
        Write-Host "  .\start-mysql-dev.ps1 start"
        Write-Host "  .\start-mysql-dev.ps1 shell"
        Write-Host "  .\start-mysql-dev.ps1 backup"
        Write-Host "  .\start-mysql-dev.ps1 restore C:\backups\backup.sql"
        Write-Host "  .\start-mysql-dev.ps1 exec C:\scripts\init.sql"
        Write-Host "  .\start-mysql-dev.ps1 menu"
    }
}