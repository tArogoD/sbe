FROM node:alpine

WORKDIR /

COPY index.js package.json .

EXPOSE 7860

RUN apk update &&\
    apk add --no-cache bash curl &&\
    npm install

CMD ["npm", "start"]
