FROM node

WORKDIR /

COPY index.js package.json .

EXPOSE 7860

RUN apt update &&\
    npm install

CMD ["npm", "start"]
