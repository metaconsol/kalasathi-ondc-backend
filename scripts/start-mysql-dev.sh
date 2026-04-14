#!/bin/bash

# start-mysql-dev.sh
# Daily MySQL Docker Development Setup

# Default action
ACTION=${1:-"start"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
header() { echo -e "${CYAN}=== $1 ===${NC}"; }

# Check if config file exists
CONFIG_FILE="$PSScriptRoot/mysql-config-dev.json"
if [ ! -f "$CONFIG_FILE" ]; then
    error "Config file not found: $CONFIG_FILE"
    exit 1
fi

# Read config file using jq (requires jq installed)
if ! command -v jq &> /dev/null; then
    error "jq is required but not installed. Please install jq first."
    error "Ubuntu/Debian: sudo apt-get install jq"
    error "MacOS: brew install jq"
    error "Windows: choco install jq or download from https://stedolan.github.io/jq/"
    exit 1
fi

# Parse JSON config
ContainerName=$(jq -r '.dockerContainerName' "$CONFIG_FILE")
MySQLPort=$(jq -r '.dockerPort' "$CONFIG_FILE")
MySQLDatabase=$(jq -r '.dockerDatabase' "$CONFIG_FILE")
MySQLUser=$(jq -r '.dockerUser' "$CONFIG_FILE")
MySQLPassword=$(jq -r '.dockerPassword' "$CONFIG_FILE")
MySQLHost=$(jq -r '.dockerHost' "$CONFIG_FILE")
MySQLImage=$(jq -r '.dockerImage' "$CONFIG_FILE")

# Display configuration
echo -e "${GREEN}----------------------------------------${NC}"
echo -e "${YELLOW}ContainerName: $ContainerName${NC}"
echo -e "${YELLOW}MySQLImage: $MySQLImage${NC}"
echo -e "${YELLOW}MySQLUser: $MySQLUser${NC}"
echo -e "${YELLOW}MySQLPassword: $MySQLPassword${NC}"
echo -e "${YELLOW}MySQLHost: $MySQLHost${NC}"
echo -e "${YELLOW}MySQLPort: $MySQLPort${NC}"
echo -e "${YELLOW}MySQLDatabase: $MySQLDatabase${NC}"
echo -e "${GREEN}----------------------------------------${NC}"

# Validate config
if [ -z "$ContainerName" ] || [ -z "$MySQLPassword" ] || [ -z "$MySQLPort" ] || \
   [ -z "$MySQLDatabase" ] || [ -z "$MySQLUser" ] || [ -z "$MySQLHost" ] || \
   [ -z "$MySQLImage" ]; then
    error "Config file is invalid. Missing required fields."
    exit 1
fi

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Check if container exists
container_exists() {
    docker ps -a --format "table {{.Names}}" | grep -q "^${ContainerName}$"
}

# Check if container is running
container_running() {
    docker ps --format "table {{.Names}}" | grep -q "^${ContainerName}$"
}

# Start MySQL container
start_container() {
    info "Starting MySQL container '$ContainerName'..."
    
    # Create data directory for persistent storage
    DATA_DIR="${SCRIPT_DIR}/mysql-data"
    if [ ! -d "$DATA_DIR" ]; then
        mkdir -p "$DATA_DIR"
        info "Created data directory: $DATA_DIR"
    fi
    
    # Create init directory
    INIT_DIR="${SCRIPT_DIR}/mysql-init"
    if [ ! -d "$INIT_DIR" ]; then
        mkdir -p "$INIT_DIR"
        info "Created init directory: $INIT_DIR"
    fi
    
    docker run -d \
        --name "$ContainerName" \
        -e MYSQL_ROOT_PASSWORD="$MySQLPassword" \
        -e MYSQL_DATABASE="$MySQLDatabase" \
        -e MYSQL_USER="$MySQLUser" \
        -e MYSQL_PASSWORD="$MySQLPassword" \
        -p "${MySQLPort}:3306" \
        -v "${DATA_DIR}:/var/lib/mysql" \
        -v "${INIT_DIR}:/docker-entrypoint-initdb.d" \
        --restart unless-stopped \
        "$MySQLImage"
    
    if [ $? -eq 0 ]; then
        info "MySQL container started successfully!"
        info "Container Name: $ContainerName"
        info "Image: $MySQLImage"
        info "User: $MySQLUser"
        info "Root Password: $MySQLPassword"
        info "Host: $MySQLHost"
        info "Port: $MySQLPort"
        info "Database: $MySQLDatabase"
        
        # Wait for MySQL to be ready
        info "Waiting for MySQL to be ready..."
        sleep 10
        
        # Test connection
        test_connection
    else
        error "Failed to start MySQL container"
    fi
}

# Stop MySQL container
stop_container() {
    info "Stopping MySQL container '$ContainerName'..."
    docker stop "$ContainerName"
    info "Container stopped"
}

# Remove MySQL container
remove_container() {
    info "Removing MySQL container '$ContainerName'..."
    docker rm "$ContainerName"
    info "Container removed"
}

# Enter MySQL shell
enter_shell() {
    info "Connecting to MySQL shell..."
    docker exec -it "$ContainerName" mysql -u"$MySQLUser" -p"$MySQLPassword"
}

# Execute SQL command
execute_sql() {
    docker exec "$ContainerName" mysql -u"$MySQLUser" -p"$MySQLPassword" -e "$1"
}

# Execute SQL file
execute_sql_file() {
    local SQL_FILE="$1"
    
    if [ ! -f "$SQL_FILE" ]; then
        error "SQL file not found: $SQL_FILE"
        return 1
    fi
    
    info "Executing SQL file: $SQL_FILE"
    
    # Execute SQL file using input redirection
    docker exec -i "$ContainerName" mysql -u"$MySQLUser" -p"$MySQLPassword" < "$SQL_FILE"
    
    if [ $? -eq 0 ]; then
        info "SQL file executed successfully"
    else
        error "Failed to execute SQL file"
    fi
}

# Test MySQL connection
test_connection() {
    info "Testing MySQL connection..."
    if docker exec "$ContainerName" mysqladmin ping -u"$MySQLUser" -p"$MySQLPassword" > /dev/null 2>&1; then
        info "MySQL is ready and accepting connections!"
        
        # Display database info
        execute_sql "SHOW DATABASES;"
    else
        warning "MySQL is not ready yet. You can check logs with: docker logs $ContainerName"
    fi
}

# Show container logs
show_logs() {
    info "Showing last 50 lines of logs..."
    docker logs --tail 50 "$ContainerName"
}

# Backup database
backup_database() {
    local BACKUP_DIR="${BACKUP_DIR:-${SCRIPT_DIR}/backups}"
    mkdir -p "$BACKUP_DIR"
    
    local TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    local BACKUP_FILE="$BACKUP_DIR/mysql_backup_$TIMESTAMP.sql"
    
    info "Creating database backup: $BACKUP_FILE"
    
    # Create backup using docker exec with output redirection
    docker exec "$ContainerName" mysqldump -u"$MySQLUser" -p"$MySQLPassword" --all-databases > "$BACKUP_FILE"
    
    if [ $? -eq 0 ]; then
        info "Backup completed!"
        local FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
        info "Backup size: $FILE_SIZE"
    else
        error "Backup failed"
    fi
}

# Restore database from backup
restore_database() {
    local BACKUP_FILE="$1"
    
    if [ ! -f "$BACKUP_FILE" ]; then
        error "Backup file not found: $BACKUP_FILE"
        return 1
    fi
    
    info "Restoring database from: $BACKUP_FILE"
    
    # Restore using input redirection
    docker exec -i "$ContainerName" mysql -u"$MySQLUser" -p"$MySQLPassword" < "$BACKUP_FILE"
    
    if [ $? -eq 0 ]; then
        info "Database restored successfully!"
    else
        error "Restore failed"
    fi
}

# List available backups
list_backups() {
    local BACKUP_DIR="${BACKUP_DIR:-${SCRIPT_DIR}/backups}"
    
    if [ -d "$BACKUP_DIR" ]; then
        local backups=($(ls -t "$BACKUP_DIR"/*.sql 2>/dev/null))
        if [ ${#backups[@]} -gt 0 ]; then
            info "Available backups:"
            for backup in "${backups[@]}"; do
                local size=$(du -h "$backup" | cut -f1)
                local modified=$(date -r "$backup" "+%Y-%m-%d %H:%M:%S")
                echo "  - $(basename "$backup") ($size) - $modified"
            done
        else
            warning "No backups found"
        fi
    else
        warning "Backup directory not found"
    fi
}

# Show container status
show_status() {
    docker ps -a --filter "name=$ContainerName"
    test_connection
}

# Interactive menu
show_menu() {
    clear
    header "MySQL Docker Development Setup"
    echo "1. Start MySQL Container"
    echo "2. Stop MySQL Container"
    echo "3. Restart MySQL Container"
    echo "4. Remove MySQL Container"
    echo "5. Enter MySQL Shell"
    echo "6. Show Container Status"
    echo "7. Show Logs"
    echo "8. Backup Database"
    echo "9. Restore Database"
    echo "10. Execute SQL File"
    echo "11. List Backups"
    echo "0. Exit"
    header ""
}

# Main execution
main() {
    check_docker
    
    case "${ACTION,,}" in
        start)
            if ! container_exists; then
                start_container
            elif ! container_running; then
                info "Container exists but not running. Starting..."
                docker start "$ContainerName"
                test_connection
            else
                info "Container is already running"
                test_connection
            fi
            ;;
        stop)
            stop_container
            ;;
        restart)
            stop_container
            sleep 2
            start_container
            ;;
        remove)
            if container_running; then
                stop_container
            fi
            remove_container
            ;;
        shell)
            enter_shell
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        backup)
            backup_database
            ;;
        restore)
            if [ $# -gt 1 ]; then
                restore_database "$2"
            else
                error "Please provide backup file path"
                info "Usage: $0 restore /path/to/backup.sql"
            fi
            ;;
        exec)
            if [ $# -gt 1 ]; then
                execute_sql_file "$2"
            else
                error "Please provide SQL file path"
                info "Usage: $0 exec /path/to/file.sql"
            fi
            ;;
        list-backups)
            list_backups
            ;;
        menu)
            while true; do
                show_menu
                read -p "Select option: " choice
                case $choice in
                    1) start_container ;;
                    2) stop_container ;;
                    3) 
                        stop_container
                        sleep 2
                        start_container
                        ;;
                    4)
                        if container_running; then
                            stop_container
                        fi
                        remove_container
                        ;;
                    5) enter_shell ;;
                    6) show_status ;;
                    7) show_logs ;;
                    8) backup_database ;;
                    9) 
                        read -p "Enter backup file path: " backup_file
                        if [ -n "$backup_file" ]; then
                            restore_database "$backup_file"
                        fi
                        ;;
                    10)
                        read -p "Enter SQL file path: " sql_file
                        if [ -n "$sql_file" ]; then
                            execute_sql_file "$sql_file"
                        fi
                        ;;
                    11) list_backups ;;
                    0) 
                        info "Exiting..."
                        exit 0
                        ;;
                    *)
                        error "Invalid option"
                        ;;
                esac
                echo ""
                read -p "Press Enter to continue..."
            done
            ;;
        *)
            error "Unknown action: $ACTION"
            echo "Available actions: start, stop, restart, remove, shell, status, logs"
            echo "  backup, restore, exec, list-backups, menu"
            echo ""
            echo "Examples:"
            echo "  $0 start                    # Start container"
            echo "  $0 shell                    # Enter MySQL shell"
            echo "  $0 backup                   # Backup database"
            echo "  $0 restore /path/to/backup.sql  # Restore database"
            echo "  $0 exec /path/to/file.sql   # Execute SQL file"
            echo "  $0 menu                     # Show interactive menu"
            ;;
    esac
}

# Run main function with all arguments
main "$@"