FROM node:20.11.1-alpine3.19

WORKDIR /

COPY index.js package.json .

EXPOSE 7860

RUN apk update &&\
    apk add --no-cache bash curl &&\
    npm install

CMD ["npm", "start"]
