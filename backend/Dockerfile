
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    gcc \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*


# Copy requirements first to leverage Docker cache
COPY requirements.txt .

# Upgrade pip first
RUN pip install --upgrade pip

# Install packages with increased timeout and retries
RUN pip install --default-timeout=1000 --retries 5 -r requirements.txt

# Install Celery for task queuing (backend doesn't need training libraries)
RUN pip install --default-timeout=1000 --retries 5 celery[redis]>=5.3.0 redis>=5.0.0 flower>=2.0.0

# Install FiftyOne for visualization
RUN pip install --default-timeout=1000 --retries 5 fiftyone>=0.23.0

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 8000
EXPOSE 5151

# Command to run the application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--log-level",  "debug", "--reload"] 