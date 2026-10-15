FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /arcade-server .

FROM alpine:3.20
WORKDIR /data
COPY --from=build /arcade-server /usr/local/bin/arcade-server
EXPOSE 8080
VOLUME ["/data"]
ENTRYPOINT ["arcade-server", "-addr", ":8080", "-db", "/data/arcade.db"]
