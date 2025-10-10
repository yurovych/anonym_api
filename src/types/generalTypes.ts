export interface Message {
  uId: string;
  message: string;
  createdAt: number;
  pending: boolean;
  chatId: string;
  userData: { age: number; sex: 'male' | 'female' };
  interlocutorData: {
    ageFrom: number;
    ageTo: number;
    sex: string;
  };
}

export interface IsTyping {
  uId: string;
  isTyping: boolean;
  chatId: string;
}

export interface Participant {
  uId: string;
  socketId: string;
  userData: {
    age: number;
    sex: 'male' | 'female';
    blackList: string[];
  };
  interlocutorData: {
    ageFrom: number;
    ageTo: number;
    sex: string;
  };
  chatId?: string;
  leftPrevious?: boolean;
}
