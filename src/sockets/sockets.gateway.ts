import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import type { IsTyping, Message, Participant } from '../types/generalTypes';
import * as process from "node:process";

const allowedOrigins = process.env.NODE_ENV === 'prod'
    ? ['https://enonym.com']
    : ['http://localhost:3000']

@WebSocketGateway({ cors: { origin: allowedOrigins } })
export class SocketsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private waitingQueue: Participant[] = [];

  private removeDuplicateSockets(chatId: string, uId: string) {
    const room = this.server.sockets.adapter.rooms.get(chatId);

    console.log(uId, "uId")

    if (room) {
      room.forEach((socketId) => {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket?.data?.userId === uId && socket?.id !== socketId) {
          console.log(`Removing duplicate socket ${socket.id} for user ${uId}`);
          socket.leave(chatId);
        }
      });
    }
  }

  private isUserInRoom(chatId: string, uId: string): boolean {
    const room = this.server.sockets.adapter.rooms.get(chatId);

    if (room) {
      for (const socketId of room) {
        const socket = this.server.sockets.sockets.get(socketId);
        if (socket?.data?.userId === uId) {
          return true;
        }
      }
    }

    return false;
  }


  handleConnection(client: Socket) {
    console.log(`User ${client.id} CONNECTED`);
    const { userId } = client.handshake.query;
    console.log(userId, "userId-----1111---0000")
    client.data.userId = userId;
  }

  async handleDisconnect(client: Socket) {
    console.log(`User ${client.id} DISCONNECTED`);
    this.waitingQueue = this.waitingQueue.filter(
        (participant) => participant.socketId !== client.id,
    );
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      await client.leave(client.data.chatId as string);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      this.server.to(client.data.chatId as string).emit('chat-ended', {
        uId: client.id,
      });
      this.notifyRoomSize(client.data.chatId as string);
      console.log(this.waitingQueue, 'Q ON DISCONNECT')
    } catch (err) {
      console.error(
          `Error during disconnecting ${client.id}:`,
          err,
      );
    }
  }

  @SubscribeMessage('reconnect-to-chat')
  async handleReconnectToChat(
      client: Socket,
      payload: Omit<Participant, 'socketId'>,
  ) {
    const { chatId, uId, interlocutorData, userData } = payload;

    const currentParticipant: Participant = {
      uId,
      socketId: client.id,
      userData,
      interlocutorData,
    };

    if (chatId) {
      const room = this.server.sockets.adapter.rooms.get(chatId);
      const usersInRoom = room ? room.size : 0;


      if (usersInRoom < 2 || this.isUserInRoom(chatId, uId)) {
        this.removeDuplicateSockets(chatId, uId);

        try {
          await client.join(chatId);
          client.data.chatId = chatId
          this.server.to(chatId).emit('reconnected', { uId });
          this.notifyRoomSize(chatId);
        } catch (err) {
          console.error(`Cannot rejoin room ${chatId}:`, err);
        }
      } else {
        this.waitingQueue.push(currentParticipant);
        client.emit('waiting-for-match');
      }
    } else {
      this.waitingQueue.push(currentParticipant);
      client.emit('waiting-for-match');
    }

    console.log(this.waitingQueue, 'Q ON RECONNECT')
  }

  @SubscribeMessage('find-chat')
  async handleFindChat(client: Socket, payload: Omit<Participant, 'socketId'>) {
    const { uId, userData, interlocutorData } = payload;
    const currentParticipant: Participant = {
      uId,
      socketId: client.id,
      userData,
      interlocutorData,
    };

    const match = this.findMatch(currentParticipant);

    if (match) {
      try {
        const chatId = this.generateChatId(uId, match.uId);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        client.data.chatId = chatId;
        const matchedSocket = this.server.sockets.sockets.get(match.socketId);
        if (matchedSocket) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          matchedSocket.data.chatId = chatId;
        }

        await client.join(chatId);
        await this.server.sockets.sockets.get(match.socketId)?.join(chatId);

        this.waitingQueue = this.waitingQueue.filter(
            (participant) =>
                participant.uId !== uId && participant.uId !== match.uId,
        );

        this.server.to(chatId).emit('chat-created', {
          chatId,
          seekerId: uId,
          matchId: match.uId,
        });

        this.notifyRoomSize(chatId);
      } catch {
        console.error('Can not join room');
      }
    } else {
      this.waitingQueue.push(currentParticipant);
      client.emit('waiting-for-match');
    }

    console.log(this.waitingQueue, 'Q ON FIND CHAT')
  }

  @SubscribeMessage('send-message')
  handleMessage(client: Socket, payload: Message) {
    const { chatId, uId, message, createdAt } = payload;

    this.server.to(chatId).emit('receive-message', {
      uId: uId,
      message: message,
      createdAt: createdAt,
      chatId: chatId,
      pending: false,
    });
  }

  @SubscribeMessage('is-typing')
  handleTyping(client: Socket, payload: IsTyping): void {
    const { uId, isTyping, chatId } = payload;

    this.server.to(chatId).emit('user-typing', {
      uId: uId,
      isTyping: isTyping,
    });
  }

  @SubscribeMessage('leave-chat')
  async handleLeaveChat(
      client: Socket,
      payload: { uId: string; chatId: string },
  ) {
    const { uId, chatId } = payload;
    try {
      await client.leave(chatId);

      this.waitingQueue = this.waitingQueue.filter(
          (participant) => participant.uId !== uId,
      );

      this.server.to(chatId).emit('chat-left', { uId });
      this.server.to(client.id).emit('chat-left', { uId });
      this.notifyRoomSize(chatId);
    } catch (err) {
      console.error(`Error during leaving the room ${chatId}:`, err);
    }

    console.log(this.waitingQueue, 'Q ON FIND LEAVE CHAT')
  }

  private notifyRoomSize(chatId: string): void {
    const room = this.server.sockets.adapter.rooms.get(chatId);
    const usersInRoom = room ? room.size : 0;
    this.server.to(chatId).emit('room-size', { usersInRoom });
  }

  private findMatch(currentParticipant: Participant): Participant | null {
    return (
        this.waitingQueue.find((participant) => {
          return (
              participant.uId !== currentParticipant.uId &&
              participant.userData.sex ===
              currentParticipant.interlocutorData.sex &&
              currentParticipant.userData.sex ===
              participant.interlocutorData.sex &&
              participant.userData.age >=
              currentParticipant.interlocutorData.ageFrom &&
              participant.userData.age <=
              currentParticipant.interlocutorData.ageTo &&
              currentParticipant.userData.age >=
              participant.interlocutorData.ageFrom &&
              currentParticipant.userData.age <=
              participant.interlocutorData.ageTo &&
              !participant.userData.blackList.includes(currentParticipant.uId) &&
              !currentParticipant.userData.blackList.includes(participant.uId)
          );
        }) || null
    );
  }

  private generateChatId(userId1: string, userId2: string): string {
    const ids = [userId1, userId2].sort();
    return `${ids[0]}_${ids[1]}`;
  }
}
