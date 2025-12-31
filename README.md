# Compliance Work Tracker

A compliance tracking system for managing deadlines, law groups, clients, and team assignments.

## Features

- **Dashboard**: Company-wise deadline grouping with expand/collapse
- **Compliance Matrix**: Track compliance status across clients and law groups
- **Client Management**: Assign teams and applicable law groups to clients
- **Team Management**: Create teams and assign members
- **User Management**: Manager can add team leads and members

## Login Credentials

- **Email**: `manager@company.com`
- **Password**: `password123`

The manager can create additional users, teams, law groups, and clients.

---

## Deploy on Ubuntu VPS (Hostinger)

### Prerequisites
- Ubuntu 20.04+ server
- Docker and Docker Compose installed

### Quick Start

1. **SSH into your server**
```bash
ssh root@your-server-ip
```

2. **Install Docker (if not already)**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

3. **Clone the repository**
```bash
git clone https://github.com/Shashank8834/excel_digi.git
cd excel_digi
```

4. **Create data directory for database persistence**
```bash
mkdir -p data
cp src/db/schema.sql data/
```

5. **Build and run with Docker Compose**
```bash
docker-compose up -d --build
```

6. **Access the app**
Open `http://your-server-ip:3000` in your browser.

### Useful Commands

```bash
# View logs
docker-compose logs -f

# Restart the app
docker-compose restart

# Stop the app
docker-compose down

# Rebuild after code changes
docker-compose up -d --build
```

### Using a Custom Domain with Nginx

1. Install Nginx: `apt install nginx`

2. Create `/etc/nginx/sites-available/compliance`:
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

3. Enable and restart:
```bash
ln -s /etc/nginx/sites-available/compliance /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

4. (Optional) Add SSL with Certbot:
```bash
apt install certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

---

## Local Development

```bash
npm install
npm start
```

Open http://localhost:3000
