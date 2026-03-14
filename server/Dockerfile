# Backend Dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
# fonts-noto-cjk: Required for PDF export with Chinese/Japanese/Korean characters
# libreoffice: Required for DOCX/PPTX → PDF conversion during import
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    fonts-noto-cjk \
    libreoffice-core libreoffice-writer libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8000

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
